import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type { FastifyPluginAsync } from "fastify";
import { SeasonNumberSchema, UploadSchema } from "../domain.ts";
import { decode, respond } from "../http.ts";
import type { Repository } from "../repository.ts";

export const matchRoutes: FastifyPluginAsync<{
  repository: Repository;
}> = async (app, { repository }) => {
  app.post<{ Params: { seasonNumber: string } }>(
    "/seasons/:seasonNumber/matches/upload",
    (request, reply) =>
      respond(
        pipe(
          Effect.Do,
          Effect.bind("seasonNumber", () =>
            decode(SeasonNumberSchema, request.params.seasonNumber),
          ),
          Effect.bind("upload", () => decode(UploadSchema, request.body)),
          Effect.flatMap(({ seasonNumber, upload }) =>
            repository.saveUpload(seasonNumber, upload.text),
          ),
        ),
        reply,
        201,
      ),
  );
};
