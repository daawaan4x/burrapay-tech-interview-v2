import { randomUUID } from "node:crypto";
import type { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  type SavedUpload,
  SeasonNotFound,
  UploadNotFound,
} from "../domain.ts";
import type { Repository } from "../repository.ts";
import { database, storedTimestamp } from "./scylla.ts";

export const makeUploadRepository = (
  client: Client,
): Pick<Repository, "getUpload" | "saveUpload"> => ({
  getUpload: (seasonNumber, uploadId) =>
    pipe(
      database(() =>
        client.execute(
          `SELECT created_at, raw_text FROM tournament.match_uploads
           WHERE season_number = ? AND upload_id = ?`,
          [seasonNumber, uploadId],
          { prepare: true },
        ),
      ),
      Effect.flatMap(
        (
          result,
        ): Effect.Effect<SavedUpload, DatabaseError | UploadNotFound> => {
          const row = result.first();

          return row
            ? pipe(
                Effect.Do,
                Effect.bind("createdAt", () =>
                  Schema.decodeUnknown(storedTimestamp)(row.get("created_at")),
                ),
                Effect.bind("text", () =>
                  Schema.decodeUnknown(Schema.String)(row.get("raw_text")),
                ),
                Effect.map(({ createdAt, text }) => ({
                  seasonNumber,
                  uploadId,
                  createdAt,
                  text,
                })),
                Effect.mapError((cause) => new DatabaseError({ cause })),
              )
            : Effect.fail(new UploadNotFound({ uploadId }));
        },
      ),
    ),

  saveUpload: (seasonNumber, text) =>
    pipe(
      Effect.Do,
      Effect.bind("season", () =>
        database(() =>
          client.execute(
            "SELECT season_number FROM tournament.seasons WHERE season_number = ?",
            [seasonNumber],
            { prepare: true },
          ),
        ),
      ),
      Effect.tap(({ season }) =>
        season.rowLength > 0
          ? Effect.void
          : Effect.fail(new SeasonNotFound({ seasonNumber })),
      ),

      Effect.bind("receipt", () =>
        Effect.sync(() => ({
          uploadId: randomUUID(),
          seasonNumber,
          createdAt: new Date().toISOString(),
        })),
      ),

      Effect.tap(({ receipt }) =>
        database(() =>
          client.execute(
            `INSERT INTO tournament.match_uploads
             (season_number, upload_id, created_at, raw_text) VALUES (?, ?, ?, ?)`,
            [seasonNumber, receipt.uploadId, new Date(receipt.createdAt), text],
            { prepare: true },
          ),
        ),
      ),

      Effect.map(({ receipt }) => receipt),
    ),
});
