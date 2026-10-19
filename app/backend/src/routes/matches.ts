import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyPluginAsync } from "fastify";
import {
  InvalidInput,
  MatchNotFound,
  SeasonNumberSchema,
  UploadSchema,
} from "../domain.ts";
import { decode, respond } from "../http.ts";
import { parseMatchText } from "../match-parser.ts";
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
          Effect.tap(({ seasonNumber }) => repository.getSeason(seasonNumber)),
          Effect.bind("match", ({ seasonNumber, matchId }) =>
            repository.findMatch(seasonNumber, matchId),
          ),
          Effect.flatMap(({ match, matchId }) =>
            match
              ? Effect.succeed(match)
              : Effect.fail(new MatchNotFound({ matchId })),
          ),
        ),
        reply,
        200,
      ),
  );

  app.register(parseUploadRoutes, { repository });
};

const noBodyMessage = "This endpoint takes no request body";

const parseUploadRoutes: FastifyPluginAsync<{
  repository: Repository;
}> = async (app, { repository }) => {
  // Keep uploads' JSON parser intact. Only an empty body is valid here.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    "*",
    // Check first byte without buffering whole request.
    { parseAs: "buffer", bodyLimit: 1 },
    (_request, body, done) =>
      body.length === 0
        ? done(null, undefined)
        : done(new InvalidInput({ message: noBodyMessage })),
  );

  app.post<{ Params: { seasonNumber: string; uploadId: string } }>(
    "/seasons/:seasonNumber/matches/uploads/:uploadId/parse",
    {
      errorHandler: (error, _request, reply) => {
        if (
          error instanceof InvalidInput ||
          error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ) {
          return reply.code(400).send({ error: noBodyMessage });
        }
        return reply.send(error);
      },
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
