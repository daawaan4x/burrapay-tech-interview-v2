import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, type QueryOptions, types } from "cassandra-driver";
import * as Effect from "effect/Effect";
import type { Season } from "../src/domain.ts";
import { makeRepository } from "../src/repository.ts";

const season: Season = {
  seasonNumber: 1,
  name: "Season 1",
  teams: { TMA: "Team A" },
};

const makeClient = () =>
  new Client({ contactPoints: ["127.0.0.1"], localDataCenter: "datacenter1" });

test("uses an atomic conditional insert for duplicate protection", (t) => {
  const client = makeClient();
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      assert.match(query, /IF NOT EXISTS/);
      assert.deepEqual(parameters, [1, season.name, season.teams]);
      assert.equal(options.prepare, true);
      return Promise.resolve({ wasApplied: () => false });
    },
  );
  return Effect.runPromise(
    makeRepository(client).createSeason(season).pipe(Effect.flip),
  ).then((error) => {
    assert.equal(error._tag, "DuplicateSeason");
  });
});

test("reads every database page and sorts seasons numerically", (t) => {
  const client = makeClient();
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      assert.match(query, /SELECT.*FROM tournament\.seasons/);
      assert.deepEqual(parameters, []);
      assert.equal(options.prepare, true);
      assert.ok(
        options.pageState === undefined || options.pageState === "next-page",
      );
      return Promise.resolve({
        rows: [
          {
            get: (column: string) =>
              ({
                season_number: types.Long.fromNumber(
                  options.pageState ? 2 : 10,
                ),
                name: season.name,
                teams: season.teams,
              })[column],
          },
        ],
        pageState: options.pageState ? null : "next-page",
      });
    },
  );
  return Effect.runPromise(makeRepository(client).listSeasons()).then(
    (seasons) => {
      assert.deepEqual(
        seasons.map((entry) => entry.seasonNumber),
        [2, 10],
      );
    },
  );
});

test("persists raw text and receipt fields in a prepared upload insert", (t) => {
  const client = makeClient();
  const rawText = "  TMA vs TMB\r\nScore: 2-0\n\nhttps://example.com/\t\n";
  const inserts: unknown[][] = [];
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      assert.equal(options.prepare, true);
      if (query.startsWith("SELECT")) return Promise.resolve({ rowLength: 1 });
      assert.match(query, /INSERT INTO tournament\.match_uploads/);
      inserts.push(parameters);
      return Promise.resolve();
    },
  );
  return Effect.runPromise(makeRepository(client).saveUpload(1, rawText)).then(
    (receipt) => {
      assert.equal(receipt.seasonNumber, 1);
      assert.match(receipt.uploadId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(inserts, [
        [1, receipt.uploadId, new Date(receipt.createdAt), rawText],
      ]);
    },
  );
});

test("does not insert an upload if the season is missing", (t) => {
  const client = makeClient();
  t.mock.method(client, "execute", (query: string) => {
    assert.match(query, /SELECT.*FROM tournament\.seasons/);
    return Promise.resolve({ rowLength: 0 });
  });
  return Effect.runPromise(
    makeRepository(client).saveUpload(1, "text").pipe(Effect.flip),
  ).then((error) => {
    assert.equal(error._tag, "SeasonNotFound");
    if (error._tag === "SeasonNotFound") assert.equal(error.seasonNumber, 1);
  });
});

test("maps driver rejection to an explicit database error", (t) => {
  const client = makeClient();
  const cause = new Error("CQL unavailable");
  t.mock.method(client, "execute", () => Promise.reject(cause));
  return Effect.runPromise(
    makeRepository(client).saveUpload(1, "text").pipe(Effect.flip),
  ).then((error) => {
    assert.equal(error._tag, "DatabaseError");
    assert.equal(error.cause, cause);
  });
});
