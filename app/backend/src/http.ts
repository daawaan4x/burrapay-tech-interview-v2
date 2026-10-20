import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyInstance, FastifyReply, RouteOptions } from "fastify";
import {
  type DatabaseError,
  type DuplicateSeason,
  InvalidInput,
  type InvalidMatchText,
  type InvalidTeamText,
  type MatchNotFound,
  type PasteExtractionError,
  type PasteRequestError,
  type PasteTimeout,
  type SeasonNotFound,
  type UploadNotFound,
} from "./domain.ts";

type ApiError =
  | InvalidInput
  | DuplicateSeason
  | SeasonNotFound
  | DatabaseError
  | UploadNotFound
  | MatchNotFound
  | InvalidMatchText
  | InvalidTeamText
  | PasteRequestError
  | PasteTimeout
  | PasteExtractionError;

export const respond = <A>(
  effect: Effect.Effect<A, ApiError>,
  reply: FastifyReply,
  response: number | ((value: A) => { status: number; body: unknown }),
) =>
  pipe(
    effect,
    Effect.flatMap((value) =>
      Effect.sync(() => {
        const result =
          typeof response === "number"
            ? { status: response, body: value }
            : response(value);
        return reply.code(result.status).send(result.body);
      }),
    ),

    Effect.catchTags({
      PasteRequestError: ({ message, cause }) =>
        Effect.sync(() => {
          reply.log.error({ err: cause, message }, "Paste request failed");

          return reply.code(502).send({ error: message });
        }),

      PasteTimeout: () =>
        Effect.sync(() => {
          reply.log.warn("Paste request exceeded 10 seconds");

          return reply.code(504).send({ error: "Paste request timed out" });
        }),

      PasteExtractionError: ({ message, cause }) =>
        Effect.sync(() => {
          reply.log.info({ err: cause }, "Paste extraction failed");

          return reply.code(422).send({ error: message });
        }),

      InvalidInput: ({ message }) =>
        Effect.sync(() => reply.code(400).send({ error: message })),

      UploadNotFound: ({ uploadId }) =>
        Effect.sync(() =>
          reply.code(404).send({ error: `Upload ${uploadId} not found` }),
        ),

      MatchNotFound: ({ matchId }) =>
        Effect.sync(() =>
          reply.code(404).send({ error: `Match ${matchId} not found` }),
        ),

      InvalidMatchText: ({ message }) =>
        Effect.sync(() => reply.code(422).send({ error: message })),

      InvalidTeamText: ({ message }) =>
        Effect.sync(() => reply.code(422).send({ error: message })),

      DuplicateSeason: ({ seasonNumber }) =>
        Effect.sync(() =>
          reply.code(409).send({
            error: `Season ${seasonNumber} already exists`,
          }),
        ),

      SeasonNotFound: ({ seasonNumber }) =>
        Effect.sync(() =>
          reply.code(404).send({
            error: `Season ${seasonNumber} not found`,
          }),
        ),

      DatabaseError: ({ cause }) =>
        Effect.sync(() => {
          reply.log.error({ err: cause }, "Database operation failed");

          return reply.code(503).send({ error: "Database unavailable" });
        }),
    }),
    Effect.runPromise,
  );

export const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  pipe(
    Schema.decodeUnknown(schema, { onExcessProperty: "error" })(input),
    Effect.mapError((error) => new InvalidInput({ message: error.message })),
  );

const noBodyMessage = "This endpoint takes no request body";

export const registerNoBodyParser = (app: FastifyInstance) => {
  app.removeAllContentTypeParsers();

  app.addContentTypeParser(
    "*",
    { parseAs: "buffer", bodyLimit: 1 },
    (_request, body, done) =>
      body.length === 0
        ? done(null, undefined)
        : done(new InvalidInput({ message: noBodyMessage })),
  );
};

export const noBodyErrorHandler: RouteOptions["errorHandler"] = (
  error,
  _request,
  reply,
) =>
  error instanceof InvalidInput || error.code === "FST_ERR_CTP_BODY_TOO_LARGE"
    ? reply.code(400).send({ error: noBodyMessage })
    : reply.send(error);
