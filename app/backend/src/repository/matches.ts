import type { Client, types } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  ImportedTeamsSchema,
  MatchParticipantsSchema,
  MatchSchema,
} from "../domain.ts";
import type { Repository } from "../repository.ts";
import { database, storedTimestamp } from "./scylla.ts";

const participantsJson = Schema.parseJson(MatchParticipantsSchema);
const importedTeamsJson = Schema.NullOr(Schema.parseJson(ImportedTeamsSchema));

const storedMatch = Schema.Struct({
  ...MatchSchema.fields,
  participants: participantsJson,
  importedTeams: importedTeamsJson,
  parsedAt: storedTimestamp,
});

const decodeMatch = (row: types.Row) =>
  pipe(
    Schema.decodeUnknown(storedMatch)({
      matchId: String(row.get("match_id")),
      uploadId: String(row.get("upload_id")),
      seasonNumber: Number(row.get("season_number")),
      winnerTeamCode: row.get("winner_team_code"),
      participants: row.get("participants"),
      importedTeams: row.get("imported_teams"),
      parsedAt: row.get("parsed_at"),
    }),
    Effect.mapError((cause) => new DatabaseError({ cause })),
  );

const readMatch = (client: Client, seasonNumber: number, matchId: string) =>
  pipe(
    database(() =>
      client.execute(
        `SELECT match_id, upload_id, season_number, parsed_at, winner_team_code,
                participants, imported_teams FROM tournament.matches
         WHERE season_number = ? AND match_id = ?`,
        [seasonNumber, matchId],
        { prepare: true },
      ),
    ),
    Effect.flatMap((result) => {
      const row = result.first();

      return row ? decodeMatch(row) : Effect.succeed(null);
    }),
  );

export const makeMatchRepository = (
  client: Client,
): Pick<Repository, "findMatch" | "saveMatch"> => ({
  findMatch: (seasonNumber, matchId) =>
    readMatch(client, seasonNumber, matchId),

  saveMatch: (match) =>
    pipe(
      Effect.Do,
      Effect.bind("participants", () =>
        Schema.encode(participantsJson)(match.participants),
      ),
      Effect.bind("importedTeams", () =>
        Schema.encode(importedTeamsJson)(match.importedTeams),
      ),
      Effect.bind("parsedAt", () =>
        Schema.decodeUnknown(Schema.Date)(match.parsedAt),
      ),
      Effect.mapError((cause) => new DatabaseError({ cause })),

      Effect.tap(() =>
        match.matchId.toLowerCase() === match.uploadId.toLowerCase()
          ? Effect.void
          : Effect.fail(
              new DatabaseError({
                cause: new Error("Match ID must equal its upload ID"),
              }),
            ),
      ),

      Effect.bind("result", ({ participants, importedTeams, parsedAt }) =>
        database(() =>
          client.execute(
            `INSERT INTO tournament.matches
             (season_number, match_id, upload_id, parsed_at, winner_team_code, participants, imported_teams)
             VALUES (?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS`,
            [
              match.seasonNumber,
              match.matchId,
              match.uploadId,
              parsedAt,
              match.winnerTeamCode,
              participants,
              importedTeams,
            ],
            { prepare: true },
          ),
        ),
      ),

      Effect.bind("saved", () =>
        readMatch(client, match.seasonNumber, match.matchId),
      ),

      Effect.flatMap(({ saved, result }) =>
        saved
          ? Effect.succeed({ match: saved, created: result.wasApplied() })
          : Effect.fail(
              new DatabaseError({
                cause: new Error("Match missing after conditional insert"),
              }),
            ),
      ),
    ),
});
