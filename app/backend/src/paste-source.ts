import { readFile } from "node:fs/promises";
import * as Config from "effect/Config";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type { PasteFetch } from "./paste-http.ts";
import { defaultImportDependencies } from "./routes/team-import.ts";

export class PasteFixtureError extends Data.TaggedError("PasteFixtureError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

type ReadFixture = (path: URL) => Promise<string>;

const readFixtures = (read: ReadFixture) =>
  Effect.forEach(["tgiS1Swl", "VvVArqgO"], (id) =>
    Effect.tryPromise({
      try: () =>
        read(
          new URL(
            `../test/fixtures/vrpaste-${id}-complete.html`,
            import.meta.url,
          ),
        ),
      catch: (cause) =>
        new PasteFixtureError({
          message: `Could not load paste fixture ${id}`,
          cause,
        }),
    }).pipe(
      Effect.map((html) => [`https://www.vrpastes.com/${id}`, html] as const),
    ),
  );

const fixtureFetch = (
  entries: ReadonlyArray<readonly [string, string]>,
): PasteFetch => {
  const fixtures = new Map(entries);

  return async (url, { signal }) => {
    signal.throwIfAborted();

    const html = fixtures.get(url);

    return new Response(html ?? null, {
      status: html === undefined ? 404 : 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };
};

const fetchMode = Config.literal(
  "live",
  "fixtures",
)("PASTE_FETCH_MODE").pipe(Config.withDefault("live"));

export const loadPasteFetch = (
  read: ReadFixture = (path) => readFile(path, "utf8"),
) =>
  pipe(
    fetchMode,
    Effect.flatMap((mode) => {
      if (mode === "live")
        return Effect.succeed(defaultImportDependencies.fetch);

      return pipe(
        readFixtures(read),
        Effect.map(fixtureFetch),
        Effect.tap(() =>
          Effect.logWarning(
            "PASTE_FETCH_MODE=fixtures: paste responses use committed HTML; this does not verify live imports",
          ),
        ),
      );
    }),
  );
