import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type { FastifyPluginAsync } from "fastify";
import { SeasonSchema } from "../domain.ts";
import { decode, respond } from "../http.ts";
import type { Repository } from "../repository.ts";

export const seasonRoutes: FastifyPluginAsync<{
  repository: Repository;
}> = async (app, { repository }) => {
  app
    .post("/seasons", (request, reply) =>
      respond(
        pipe(
          decode(SeasonSchema, request.body),
          Effect.flatMap(repository.createSeason),
        ),
        reply,
        201,
      ),
    )
    .get("/seasons", (_request, reply) =>
      respond(repository.listSeasons(), reply, 200),
    );
};
