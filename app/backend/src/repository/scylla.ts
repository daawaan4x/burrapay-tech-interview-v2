import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import { DatabaseError } from "../domain.ts";

export const database = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) => new DatabaseError({ cause }),
  });

export const storedTimestamp = Schema.transform(
  Schema.ValidDateFromSelf,
  Schema.String,
  {
    decode: (date) => date.toISOString(),
    encode: (text) => new Date(text),
  },
);

const schemaStatements = [
  `CREATE KEYSPACE IF NOT EXISTS tournament
   WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1}`,

  `CREATE TABLE IF NOT EXISTS tournament.seasons (
    season_number bigint PRIMARY KEY,
    name text,
    teams map<text, text>
  )`,

  `CREATE TABLE IF NOT EXISTS tournament.match_uploads (
    season_number bigint,
    upload_id uuid,
    created_at timestamp,
    raw_text text,
    PRIMARY KEY (season_number, upload_id)
  )`,

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
];

const initialize = (client: Client) =>
  Effect.forEach(
    schemaStatements,
    (statement) => database(() => client.execute(statement)),
    { concurrency: 1, discard: true },
  );

export const checkHealth = (client: Client) =>
  pipe(
    database(() => client.execute("SELECT release_version FROM system.local")),
    Effect.asVoid,
  );

export const openClient = (contactPoints: string[], localDataCenter: string) =>
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
  );
