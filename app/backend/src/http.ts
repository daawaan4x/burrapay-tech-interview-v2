import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyReply } from "fastify";
import {
  type DatabaseError,
  type DuplicateSeason,
  InvalidInput,
  type InvalidMatchText,
  type MatchNotFound,
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
  | InvalidMatchText;

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
        pipe(
          Effect.sync(() =>
            reply.log.error({ err: cause }, "Database operation failed"),
          ),
          Effect.map(() =>
            reply.code(503).send({ error: "Database unavailable" }),
          ),
        ),
    }),
    Effect.runPromise,
  );

export const decode = <A, I>(schema: Schema.Schema<A, I>, input: unknown) =>
  pipe(
    Schema.decodeUnknown(schema, { onExcessProperty: "error" })(input),
    Effect.mapError((error) => new InvalidInput({ message: error.message })),
  );
