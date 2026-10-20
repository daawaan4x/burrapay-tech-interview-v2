import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { pipe } from "effect/Function";
import { buildApp } from "./app.ts";
import { openRepository } from "./repository.ts";

const configuration = Config.all({
  port: Config.integer("PORT").pipe(
    Config.withDefault(3001),
    Config.validate({
      message: "PORT must be between 1 and 65535",
      validation: (port) => port > 0 && port <= 65535,
    }),
  ),
  host: Config.string("HOST").pipe(Config.withDefault("127.0.0.1")),
  contactPoints: Config.string("SCYLLA_CONTACT_POINTS").pipe(
    Config.withDefault("127.0.0.1"),
    Config.map((value) => value.split(",").map((host) => host.trim())),
    Config.validate({
      message: "SCYLLA_CONTACT_POINTS must contain nonempty host names",
      validation: (hosts) => hosts.every((host) => host.length > 0),
    }),
  ),
  localDataCenter: Config.string("SCYLLA_LOCAL_DATACENTER").pipe(
    Config.withDefault("datacenter1"),
  ),
});

const server = pipe(
  Effect.Do,
  Effect.bind("config", () => configuration),
  Effect.bind("repository", ({ config }) =>
    openRepository(config.contactPoints, config.localDataCenter),
  ),
  Effect.bind("app", ({ repository }) =>
    Effect.acquireRelease(
      Effect.sync(() => buildApp(repository)),
      (app) =>
        Effect.promise(() => app.close()).pipe(
          Effect.tapErrorCause((cause) => Effect.logError(Cause.pretty(cause))),
        ),
    ),
  ),
  Effect.tap(({ app, config }) =>
    Effect.tryPromise(() =>
      app.listen({ port: config.port, host: config.host }),
    ),
  ),
  Effect.andThen(Effect.never),
  Effect.scoped,
);

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

Effect.runPromiseExit(server, { signal: controller.signal }).then((exit) =>
  Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause)
    ? Effect.runPromise(
        Effect.logError(Cause.pretty(exit.cause)).pipe(
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = 1;
            }),
          ),
        ),
      )
    : undefined,
);
