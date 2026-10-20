import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyPluginAsync } from "fastify";
import { SeasonNumberSchema, UploadSchema } from "../domain.ts";
import {
  decode,
  noBodyErrorHandler,
  registerNoBodyParser,
  respond,
} from "../http.ts";
import { parseMatchText } from "../match-parser.ts";
import type { Repository } from "../repository.ts";
import { loadMatch } from "./match.helpers.ts";
import { type ImportDependencies, teamImportRoutes } from "./team-import.ts";

export const matchRoutes: FastifyPluginAsync<{
  repository: Repository;
  dependencies: ImportDependencies;
}> = async (app, { repository, dependencies }) => {
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

  app.get<{ Params: { seasonNumber: string; matchId: string } }>(
    "/seasons/:seasonNumber/matches/:matchId",
    (request, reply) =>
      respond(
        pipe(
          Effect.Do,
          Effect.bind("seasonNumber", () =>
            decode(SeasonNumberSchema, request.params.seasonNumber),
          ),
          Effect.bind("matchId", () =>
            decode(Schema.UUID, request.params.matchId),
          ),
          Effect.flatMap(({ seasonNumber, matchId }) =>
            loadMatch(repository, seasonNumber, matchId),
          ),
        ),
        reply,
        200,
      ),
  );

  app.register(parseUploadRoutes, { repository });
  app.register(teamImportRoutes, { repository, dependencies });
};

const parseUploadRoutes: FastifyPluginAsync<{
  repository: Repository;
}> = async (app, { repository }) => {
  registerNoBodyParser(app);

  app.post<{ Params: { seasonNumber: string; uploadId: string } }>(
    "/seasons/:seasonNumber/matches/uploads/:uploadId/parse",
    {
      errorHandler: noBodyErrorHandler,
    },
    (request, reply) =>
      respond(
        pipe(
          Effect.Do,
          Effect.bind("seasonNumber", () =>
            decode(SeasonNumberSchema, request.params.seasonNumber),
          ),
          Effect.bind("uploadId", () =>
            decode(Schema.UUID, request.params.uploadId),
          ),
          Effect.bind("season", ({ seasonNumber }) =>
            repository.getSeason(seasonNumber),
          ),
          Effect.bind("upload", ({ seasonNumber, uploadId }) =>
            repository.getUpload(seasonNumber, uploadId),
          ),
          Effect.bind("match", ({ seasonNumber, uploadId }) =>
            repository.findMatch(seasonNumber, uploadId),
          ),

          Effect.flatMap(({ match, upload, season }) => {
            if (match) return Effect.succeed({ created: false, match });
            return pipe(
              parseMatchText(upload.text, season.teams),
              Effect.flatMap((parsed) =>
                repository.saveMatch({
                  matchId: upload.uploadId,
                  uploadId: upload.uploadId,
                  seasonNumber: season.seasonNumber,
                  participants: parsed.participants,
                  parsedAt: new Date().toISOString(),
                  winnerTeamCode: parsed.winner,
                  importedTeams: null,
                }),
              ),
            );
          }),
        ),
        reply,
        ({ created, match }) => ({
          status: created ? 201 : 200,
          body: match,
        }),
      ),
  );
};
