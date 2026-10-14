import * as Effect from "effect/Effect";
import type { FastifyPluginAsync } from "fastify";
import { respond } from "../http.ts";
import type { Repository } from "../repository.ts";

export const systemRoutes: FastifyPluginAsync<{
  repository: Repository;
}> = async (app, { repository }) => {
  app
    .get("/", () => ({ message: "Hello from Fastify" }))
    .get("/health", (_request, reply) =>
      respond(
        repository.health().pipe(Effect.as({ status: "ok" })),
        reply,
        200,
      ),
    );
};
