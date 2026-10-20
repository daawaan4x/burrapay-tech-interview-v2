import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { buildApp } from "../src/app.ts";
import type { Season, UploadReceipt } from "../src/domain.ts";
import { openRepository, type Repository } from "../src/repository.ts";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "./matches.fixtures.ts";

const contactPoints = process.env.SCYLLA_TEST_CONTACT_POINTS;
const localDataCenter = process.env.SCYLLA_LOCAL_DATACENTER ?? "datacenter1";

const integration = { skip: !contactPoints };

const cleanupSeasons = async (client: Client, seasons: readonly number[]) => {
  const results = await Promise.allSettled(
    seasons.flatMap((seasonNumber) =>
      ["matches", "match_uploads", "seasons"].map((table) =>
        client.execute(
          `DELETE FROM tournament.${table} WHERE season_number = ?`,
          [seasonNumber],
          { prepare: true },
        ),
      ),
    ),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Scylla test cleanup failed");
};

interface ScyllaTest {
  readonly repository: Repository;
  readonly client: Client;
  readonly app: ReturnType<typeof buildApp>;
  readonly createSeason: () => Promise<Season>;
}

// Only resource setup and ownership are shared; each case supplies its behavior.
const withScylla = (run: (context: ScyllaTest) => Promise<void>) =>
  Effect.runPromise(
    pipe(
      Effect.Do,
      Effect.bind("repository", () =>
        openRepository(
          (contactPoints ?? "127.0.0.1").split(","),
          localDataCenter,
        ),
      ),
      Effect.bind("client", () =>
        pipe(
          Effect.acquireRelease(
            Effect.sync(
              () =>
                new Client({
                  contactPoints: (contactPoints ?? "127.0.0.1").split(","),
                  localDataCenter,
                }),
            ),
            (client) => Effect.promise(() => client.shutdown()),
          ),
          Effect.tap((client) => Effect.promise(() => client.connect())),
        ),
      ),
      Effect.bind("ownedSeasons", ({ client }) =>
        Effect.acquireRelease(
          Effect.sync<number[]>(() => []),
          (seasons) => Effect.promise(() => cleanupSeasons(client, seasons)),
        ),
      ),
      Effect.bind("app", ({ repository }) =>
        Effect.acquireRelease(
          Effect.sync(() => buildApp(repository, false)),
          (app) => Effect.promise(() => app.close()),
        ),
      ),
      Effect.flatMap(({ repository, client, app, ownedSeasons }) =>
        Effect.promise(() =>
          run({
            repository,
            client,
            app,
            createSeason: async () => {
              const season: Season = {
                seasonNumber: randomInt(1, 2 ** 48 - 1),
                name: "Integration test season",
                teams: { TMA: "Team A", TMB: "Team B" },
              };
              const response = await app.inject({
                method: "POST",
                url: "/seasons",
                payload: season,
              });
              // Register confirmed ownership before any response assertion can fail.
              if (response.statusCode === 201)
                ownedSeasons.push(season.seasonNumber);
              assert.equal(response.statusCode, 201, response.body);
              assert.deepEqual(response.json(), season);
              return season;
            },
          }),
        ),
      ),
      Effect.scoped,
    ),
  );

test(
  "Scylla imports: concurrent updates preserve one complete import and its match",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const matchId = randomUUID();
      const match = {
        ...makeMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId,
        uploadId: matchId,
      };

      await Effect.runPromise(repository.saveMatch(match));

      const first = makeImportedMatchRecord().importedTeams;
      assert.ok(first);

      const second = {
        ...structuredClone(first),
        importedAt: "2026-10-20T00:00:00.000Z",
        participants: [
          {
            ...first.participants[0],
            rawText: "Alternate opaque storage text A",
          },
          {
            ...first.participants[1],
            rawText: "Alternate opaque storage text B",
          },
        ] as const,
      };

      const results = await Effect.runPromise(
        Effect.all(
          [first, second].map((teams) =>
            repository.saveImportedTeams(season.seasonNumber, matchId, teams),
          ),
          { concurrency: 2 },
        ),
      );
      const winner = results[0];

      assert.deepEqual(results[1], winner);
      assert.ok(
        [first.importedAt, second.importedAt].includes(
          winner.importedTeams?.importedAt ?? "",
        ),
      );
      assert.deepEqual(
        winner.importedTeams,
        winner.importedTeams?.importedAt === first.importedAt ? first : second,
      );
      assert.deepEqual({ ...winner, importedTeams: null }, match);

      const stored = await client.execute(
        "SELECT imported_teams, participants, parsed_at FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, matchId],
        { prepare: true },
      );

      assert.deepEqual(
        JSON.parse(stored.first().get("imported_teams")),
        winner.importedTeams,
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("participants")),
        match.participants,
      );
      assert.deepEqual(
        stored.first().get("parsed_at"),
        new Date(match.parsedAt),
      );

      const repeated = await Effect.runPromise(
        repository.saveImportedTeams(season.seasonNumber, matchId, second),
      );

      assert.deepEqual(repeated, winner);
    }),
);

test(
  "Scylla imports: a missing match is not created by an import update",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const missingId = randomUUID();
      const teams = makeImportedMatchRecord().importedTeams;
      assert.ok(teams);

      const error = await Effect.runPromise(
        Effect.flip(
          repository.saveImportedTeams(season.seasonNumber, missingId, teams),
        ),
      );

      assert.equal(error._tag, "MatchNotFound");

      const missing = await client.execute(
        "SELECT * FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, missingId],
        { prepare: true },
      );

      assert.equal(missing.rowLength, 0);
    }),
);

test(
  "Scylla integration: seasons, duplicates, raw uploads, and database readback",
  integration,
  () =>
    withScylla(async ({ app, client, createSeason }) => {
      const season = await createSeason();
      const duplicate = await app.inject({
        method: "POST",
        url: "/seasons",
        payload: { ...season, name: "Must not overwrite" },
      });
      assert.equal(duplicate.statusCode, 409);

      const listed = await app.inject("/seasons");
      assert.equal(listed.statusCode, 200);
      assert.deepEqual(
        listed
          .json<Season[]>()
          .find((entry) => entry.seasonNumber === season.seasonNumber),
        season,
      );

      const text =
        "  TMA vs TMB\r\nPlayer A vs Player B\nScore: 2-0\n\nPlayer A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)\nPlayer B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)\n";
      const uploaded = await app.inject({
        method: "POST",
        url: `/seasons/${season.seasonNumber}/matches/upload`,
        payload: { text },
      });
      assert.equal(uploaded.statusCode, 201, uploaded.body);
      const receipt = uploaded.json<UploadReceipt>();

      const stored = await client.execute(
        `SELECT raw_text, created_at FROM tournament.match_uploads
         WHERE season_number = ? AND upload_id = ?`,
        [season.seasonNumber, receipt.uploadId],
        { prepare: true },
      );
      assert.equal(stored.rowLength, 1);
      assert.equal(stored.first().get("raw_text"), text);
      assert.deepEqual(
        stored.first().get("created_at"),
        new Date(receipt.createdAt),
      );
      assert.equal(receipt.seasonNumber, season.seasonNumber);
    }),
);

test("cleanup attempts every owned table and reports failed deletes", async (t) => {
  const client = new Client({ contactPoints: ["127.0.0.1"], localDataCenter });
  const cause = new Error("One delete failed");
  const execute = t.mock.method(client, "execute", (query: string) =>
    query.includes("match_uploads") ? Promise.reject(cause) : Promise.resolve(),
  );

  await assert.rejects(cleanupSeasons(client, [7]), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [cause]);
    return true;
  });
  assert.deepEqual(
    execute.mock.calls.map((call) => call.arguments[0]).sort(),
    [
      "DELETE FROM tournament.matches WHERE season_number = ?",
      "DELETE FROM tournament.match_uploads WHERE season_number = ?",
      "DELETE FROM tournament.seasons WHERE season_number = ?",
    ].sort(),
  );
});

test(
  "Scylla storage: overlapping saves return one winning record and preserve it on repeat",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const upload = await Effect.runPromise(
        repository.saveUpload(season.seasonNumber, "Opaque storage fixture"),
      );
      // Already structured setup; no parser, fetch, or live import runs here.
      const first = {
        ...makeImportedMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId: upload.uploadId,
        uploadId: upload.uploadId,
      };
      const second = {
        ...structuredClone(first),
        parsedAt: "2026-10-19T00:00:00.000Z",
      };
      const results = await Effect.runPromise(
        Effect.all(
          [repository.saveMatch(first), repository.saveMatch(second)],
          { concurrency: 2 },
        ),
      );
      assert.equal(results.filter((result) => result.created).length, 1);
      const winner = results.find((result) => result.created);
      assert.ok(winner);
      assert.ok(
        [first.parsedAt, second.parsedAt].includes(winner.match.parsedAt),
      );
      results.forEach((result) => {
        assert.deepEqual(result.match, winner.match);
      });

      const stored = await client.execute(
        "SELECT parsed_at, participants, imported_teams FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, upload.uploadId],
        { prepare: true },
      );
      assert.equal(stored.rowLength, 1);
      assert.deepEqual(
        stored.first().get("parsed_at"),
        new Date(winner.match.parsedAt),
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("participants")),
        makeImportedMatchRecord().participants,
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("imported_teams")),
        makeImportedMatchRecord().importedTeams,
      );
      const repeated = await Effect.runPromise(
        repository.saveMatch({
          ...first,
          importedTeams: null,
          parsedAt: "2026-10-19T01:00:00.000Z",
        }),
      );
      assert.deepEqual(repeated, { created: false, match: winner.match });
    }),
);

test(
  "Scylla HTTP: saved matches are retrievable only within their season",
  integration,
  () =>
    withScylla(async ({ repository, app, createSeason }) => {
      const season = await createSeason();
      const otherSeason = await createSeason();
      const upload = await Effect.runPromise(
        repository.saveUpload(season.seasonNumber, "Opaque HTTP fixture"),
      );
      const expected = {
        ...makeImportedMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId: upload.uploadId,
        uploadId: upload.uploadId,
      };
      await Effect.runPromise(repository.saveMatch(structuredClone(expected)));

      const found = await app.inject(
        `/seasons/${season.seasonNumber}/matches/${upload.uploadId}`,
      );
      assert.equal(found.statusCode, 200, found.body);
      assert.deepEqual(found.json(), expected);
      const repeated = await app.inject({
        method: "POST",
        url: `/seasons/${season.seasonNumber}/matches/uploads/${upload.uploadId}/parse`,
      });
      assert.equal(repeated.statusCode, 200, repeated.body);
      assert.deepEqual(repeated.json(), expected);
      const wrongMatch = await app.inject(
        `/seasons/${otherSeason.seasonNumber}/matches/${upload.uploadId}`,
      );
      const wrongUpload = await app.inject({
        method: "POST",
        url: `/seasons/${otherSeason.seasonNumber}/matches/uploads/${upload.uploadId}/parse`,
      });
      assert.equal(wrongMatch.statusCode, 404);
      assert.equal(wrongUpload.statusCode, 404);
      assert.equal(typeof wrongMatch.json().error, "string");
      assert.equal(typeof wrongUpload.json().error, "string");
    }),
);
