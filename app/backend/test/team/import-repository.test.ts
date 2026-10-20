import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, type QueryOptions } from "cassandra-driver";
import * as Effect from "effect/Effect";
import type { ImportedTeams } from "../../src/domain.ts";
import { makeRepository } from "../../src/repository.ts";
import { makeImportedMatchRecord } from "../matches/fixtures.ts";

const clientForTest = () =>
  new Client({ contactPoints: ["127.0.0.1"], localDataCenter: "datacenter1" });
const saved = makeImportedMatchRecord();
const importedTeams = saved.importedTeams;
assert.ok(importedTeams);

const storedValues: Record<string, unknown> = {
  season_number: saved.seasonNumber,
  match_id: saved.matchId,
  upload_id: saved.uploadId,
  parsed_at: new Date(saved.parsedAt),
  winner_team_code: saved.winnerTeamCode,
  participants: JSON.stringify(saved.participants),
};
const rowFor = (teams: ImportedTeams | null) => {
  const values: Record<string, unknown> = {
    ...storedValues,
    imported_teams: teams === null ? null : JSON.stringify(teams),
  };

  return { get: (column: string) => values[column] };
};

[
  { name: "attempted import", importedAt: "2026-10-20T00:00:00.000Z" },
  {
    name: "different import",
    importedAt: "2026-10-14T00:05:00.000Z",
  },
].forEach(({ name, importedAt }) => {
  test(`import updates send their fields and decode the ${name} from driver readback`, async (t) => {
    const client = clientForTest();
    const attempted = {
      ...importedTeams,
      importedAt: "2026-10-20T00:00:00.000Z",
    };
    const persistedTeams = { ...importedTeams, importedAt };
    const updates: unknown[][] = [];

    t.mock.method(
      client,
      "execute",
      (query: string, parameters: unknown[], options: QueryOptions) => {
        assert.equal(options.prepare, true);

        if (query.startsWith("UPDATE")) {
          assert.match(
            query,
            /IF\s+imported_teams\s*=\s*null\s+AND\s+upload_id\s*!=\s*null/,
          );
          updates.push(parameters);

          return Promise.resolve({});
        }

        assert.match(query, /^SELECT/);
        assert.deepEqual(parameters, [1, saved.matchId]);

        return Promise.resolve({ first: () => rowFor(persistedTeams) });
      },
    );

    const result = await Effect.runPromise(
      makeRepository(client).saveImportedTeams(1, saved.matchId, attempted),
    );

    assert.deepEqual(updates, [[JSON.stringify(attempted), 1, saved.matchId]]);
    assert.deepEqual(result, { ...saved, importedTeams: persistedTeams });
  });
});

["UPDATE", "SELECT"].forEach((operation) => {
  test(`a failed import ${operation} preserves the driver cause`, async (t) => {
    const client = clientForTest();
    const cause = new Error("Driver unavailable");

    t.mock.method(client, "execute", (query: string) =>
      query.startsWith(operation) ? Promise.reject(cause) : Promise.resolve({}),
    );

    const error = await Effect.runPromise(
      Effect.flip(
        makeRepository(client).saveImportedTeams(
          1,
          saved.matchId,
          importedTeams,
        ),
      ),
    );

    assert.ok(error._tag === "DatabaseError");
    assert.equal(error.cause, cause);
  });
});

test("a missing import target reports MatchNotFound", async (t) => {
  const client = clientForTest();

  t.mock.method(client, "execute", (query: string) =>
    Promise.resolve(query.startsWith("UPDATE") ? {} : { first: () => null }),
  );

  const error = await Effect.runPromise(
    Effect.flip(
      makeRepository(client).saveImportedTeams(1, saved.matchId, importedTeams),
    ),
  );

  assert.equal(error._tag, "MatchNotFound");
});

test("readback without an import is a database failure", async (t) => {
  const client = clientForTest();

  t.mock.method(client, "execute", (query: string) =>
    Promise.resolve(
      query.startsWith("UPDATE")
        ? {}
        : {
            first: () => rowFor(null),
          },
    ),
  );

  const error = await Effect.runPromise(
    Effect.flip(
      makeRepository(client).saveImportedTeams(1, saved.matchId, importedTeams),
    ),
  );

  assert.equal(error._tag, "DatabaseError");
});
