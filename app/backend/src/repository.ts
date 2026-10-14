import { randomUUID } from "node:crypto";
import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  DuplicateSeason,
  type Season,
  SeasonNotFound,
  SeasonSchema,
  type UploadReceipt,
} from "./domain.ts";

export interface Repository {
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
