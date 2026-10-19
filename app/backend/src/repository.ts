import { randomUUID } from "node:crypto";
import { Client, type types } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  DuplicateSeason,
  ImportedTeamsSchema,
  type Match,
  MatchParticipantsSchema,
  type MatchSaveResult,
  MatchSchema,
  type SavedUpload,
  type Season,
  SeasonNotFound,
  SeasonSchema,
  UploadNotFound,
  type UploadReceipt,
} from "./domain.ts";

export interface Repository {
  readonly getSeason: (
    seasonNumber: number,
  ) => Effect.Effect<Season, DatabaseError | SeasonNotFound>;
  readonly getUpload: (
    seasonNumber: number,
    uploadId: string,
  ) => Effect.Effect<SavedUpload, DatabaseError | UploadNotFound>;
  readonly findMatch: (
    seasonNumber: number,
    matchId: string,
  ) => Effect.Effect<Match | null, DatabaseError>;
  readonly saveMatch: (
    match: Match,
  ) => Effect.Effect<MatchSaveResult, DatabaseError>;
  readonly createSeason: (
    season: Season,
  ) => Effect.Effect<Season, DatabaseError | DuplicateSeason>;
  readonly listSeasons: () => Effect.Effect<readonly Season[], DatabaseError>;
  readonly saveUpload: (
    seasonNumber: number,
    text: string,
  ) => Effect.Effect<UploadReceipt, DatabaseError | SeasonNotFound>;
  readonly health: () => Effect.Effect<void, DatabaseError>;
}

const database = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new DatabaseError({ cause }),
  });

const initialize = (client: Client) =>
  pipe(
    database(() =>
      client.execute(
        `CREATE KEYSPACE IF NOT EXISTS tournament
         WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,
      ),
    ),
    Effect.andThen(
      database(() =>
        client.execute(
          `CREATE TABLE IF NOT EXISTS tournament.seasons (
            season_number bigint PRIMARY KEY,
            name text,
            teams map<text, text>
          )`,
        ),
      ),
    ),
    Effect.andThen(
      database(() =>
        client.execute(
          `CREATE TABLE IF NOT EXISTS tournament.match_uploads (
            season_number bigint,
            upload_id uuid,
            created_at timestamp,
            raw_text text,
            PRIMARY KEY (season_number, upload_id)
          )`,
        ),
      ),
    ),
    Effect.andThen(
      database(() =>
        client.execute(
          `CREATE TABLE IF NOT EXISTS tournament.matches (
            season_number bigint,
            match_id uuid,
            upload_id uuid,
            parsed_at timestamp,
            winner_team_code text,
            participants text,
            imported_teams text,
            PRIMARY KEY (season_number, match_id)
          )`,
        ),
      ),
    ),
  );

const participantsJson = Schema.parseJson(MatchParticipantsSchema);
const importedTeamsJson = Schema.NullOr(Schema.parseJson(ImportedTeamsSchema));

const storedTimestamp = Schema.transform(
  Schema.ValidDateFromSelf,
  Schema.String,
  {
    decode: (date) => date.toISOString(),
    encode: (text) => new Date(text),
  },
);

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

const readSeasons = (
  client: Client,
  pageState?: string,
): Effect.Effect<readonly Season[], DatabaseError> =>
  pipe(
    Effect.Do,
    Effect.bind("result", () =>
      database(() =>
        client.execute(
          "SELECT season_number, name, teams FROM tournament.seasons",
          [],
          { prepare: true, pageState },
        ),
      ),
    ),
    Effect.bind("seasons", ({ result }) =>
      Effect.forEach(result.rows, (row) =>
        pipe(
          Schema.decodeUnknown(SeasonSchema)({
            seasonNumber: Number(row.get("season_number")),
            name: row.get("name"),
            teams: row.get("teams"),
          }),
          Effect.mapError((cause) => new DatabaseError({ cause })),
        ),
      ),
    ),
    Effect.flatMap(({ result, seasons }) =>
      result.pageState
        ? pipe(
            Effect.suspend(() => readSeasons(client, result.pageState)),
            Effect.map((nextSeasons) => [...seasons, ...nextSeasons]),
          )
        : Effect.succeed(seasons),
    ),
  );

export const makeRepository = (client: Client): Repository => ({
  getSeason: (seasonNumber) =>
    pipe(
      database(() =>
        client.execute(
          "SELECT season_number, name, teams FROM tournament.seasons WHERE season_number = ?",
          [seasonNumber],
          { prepare: true },
        ),
      ),
      Effect.flatMap(
        (result): Effect.Effect<Season, DatabaseError | SeasonNotFound> => {
          const row = result.first();
          return row
            ? pipe(
                Schema.decodeUnknown(SeasonSchema)({
                  seasonNumber: Number(row.get("season_number")),
                  name: row.get("name"),
                  teams: row.get("teams"),
                }),
                Effect.mapError((cause) => new DatabaseError({ cause })),
              )
            : Effect.fail(new SeasonNotFound({ seasonNumber }));
        },
      ),
    ),
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
  createSeason: (season) =>
    pipe(
      database(() =>
        client.execute(
          `INSERT INTO tournament.seasons (season_number, name, teams)
           VALUES (?, ?, ?) IF NOT EXISTS`,
          [season.seasonNumber, season.name, season.teams],
          { prepare: true },
        ),
      ),
      Effect.flatMap((result) =>
        result.wasApplied()
          ? Effect.succeed(season)
          : Effect.fail(
              new DuplicateSeason({ seasonNumber: season.seasonNumber }),
            ),
      ),
    ),
  listSeasons: () =>
    pipe(
      readSeasons(client),
      Effect.map((seasons) =>
        seasons.toSorted((a, b) => a.seasonNumber - b.seasonNumber),
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
  health: () =>
    pipe(
      database(() =>
        client.execute("SELECT release_version FROM system.local"),
      ),
      Effect.asVoid,
    ),
});

export const openRepository = (
  contactPoints: string[],
  localDataCenter: string,
) =>
  pipe(
    Effect.acquireRelease(
      Effect.sync(() => new Client({ contactPoints, localDataCenter })),
      (client) =>
        database(() => client.shutdown()).pipe(
          Effect.tapErrorCause((cause) => Effect.logError(cause)),
          Effect.orDie,
        ),
    ),
    Effect.tap((client) => database(() => client.connect())),
    Effect.tap(initialize),
    Effect.map(makeRepository),
  );
