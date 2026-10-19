import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, type QueryOptions } from "cassandra-driver";
import * as Effect from "effect/Effect";
import * as ParseResult from "effect/ParseResult";
import { type Match, SeasonNotFound, UploadNotFound } from "../src/domain.ts";
import { makeRepository } from "../src/repository.ts";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "./matches.fixtures.ts";

const makeClient = () =>
  new Client({ contactPoints: ["127.0.0.1"], localDataCenter: "datacenter1" });

const rowFor = (match: Match, overrides: Record<string, unknown> = {}) => {
  const values: Record<string, unknown> = {
    season_number: match.seasonNumber,
    match_id: match.matchId,
    upload_id: match.uploadId,
    parsed_at: new Date(match.parsedAt),
    winner_team_code: match.winnerTeamCode,
    participants: JSON.stringify(match.participants),
    imported_teams:
      match.importedTeams === null ? null : JSON.stringify(match.importedTeams),
    ...overrides,
  };
  return { get: (column: string) => values[column] };
};

test("a mismatched match UUID is rejected without database access", async (t) => {
  const client = makeClient();
  const execute = t.mock.method(client, "execute", () =>
    Promise.reject(new Error("Unexpected database access")),
  );
  const input = {
    ...makeMatchRecord(),
    matchId: "0665d87f-b16e-4cc3-9ae0-c0a998bdf893",
  };
  const error = await Effect.runPromise(
    Effect.flip(makeRepository(client).saveMatch(input)),
  );
  assert.equal(error._tag, "DatabaseError");
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, "Match ID must equal its upload ID");
  assert.equal(execute.mock.callCount(), 0);
});

test("match reads pass the requested season and UUID to a prepared query", async (t) => {
  const client = makeClient();
  const { matchId } = makeMatchRecord();
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      assert.match(query, /season_number\s*=\s*\?/);
      assert.match(query, /match_id\s*=\s*\?/);
      assert.deepEqual(parameters, [2, matchId]);
      assert.equal(options.prepare, true);
      return Promise.resolve({ first: () => null });
    },
  );
  const match = await Effect.runPromise(
    makeRepository(client).findMatch(2, matchId),
  );
  assert.equal(match, null);
});

test("upload reads preserve raw text and use the requested season and UUID", async (t) => {
  const client = makeClient();
  const { uploadId, parsedAt } = makeMatchRecord();
  const text = "  Uninterpreted text\r\n\n\t";
  const values: Record<string, unknown> = {
    created_at: new Date(parsedAt),
    raw_text: text,
  };
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      assert.match(query, /season_number\s*=\s*\?/);
      assert.match(query, /upload_id\s*=\s*\?/);
      assert.deepEqual(parameters, [2, uploadId]);
      assert.equal(options.prepare, true);
      return Promise.resolve({
        first: () => ({ get: (column: string) => values[column] }),
      });
    },
  );
  const upload = await Effect.runPromise(
    makeRepository(client).getUpload(2, uploadId),
  );
  assert.deepEqual(upload, {
    seasonNumber: 2,
    uploadId,
    createdAt: parsedAt,
    text,
  });
});

test("a missing season reports the requested season number", async (t) => {
  const client = makeClient();
  t.mock.method(client, "execute", () =>
    Promise.resolve({ first: () => null }),
  );
  const error = await Effect.runPromise(
    Effect.flip(makeRepository(client).getSeason(2)),
  );
  assert.ok(error instanceof SeasonNotFound);
  assert.equal(error.seasonNumber, 2);
});

test("a missing upload reports the requested UUID", async (t) => {
  const client = makeClient();
  const { uploadId } = makeMatchRecord();
  t.mock.method(client, "execute", () =>
    Promise.resolve({ first: () => null }),
  );
  const error = await Effect.runPromise(
    Effect.flip(makeRepository(client).getUpload(2, uploadId)),
  );
  assert.ok(error instanceof UploadNotFound);
  assert.equal(error.uploadId, uploadId);
});

test("new match creation writes its fields and returns stored data", async (t) => {
  const client = makeClient();
  const input = makeMatchRecord();
  const expected = makeMatchRecord();
  const inserts: unknown[][] = [];
  t.mock.method(
    client,
    "execute",
    (query: string, parameters: unknown[], options: QueryOptions) => {
      if (query.startsWith("INSERT")) {
        assert.match(query, /IF\s+NOT\s+EXISTS/);
        assert.equal(options.prepare, true);
        inserts.push(parameters);
        return Promise.resolve({ wasApplied: () => true });
      }
      return Promise.resolve({ first: () => rowFor(expected) });
    },
  );
  const result = await Effect.runPromise(
    makeRepository(client).saveMatch(input),
  );
  assert.deepEqual(result, { created: true, match: expected });
  assert.deepEqual(inserts, [
    [
      1,
      expected.matchId,
      expected.uploadId,
      new Date(expected.parsedAt),
      expected.winnerTeamCode,
      JSON.stringify(expected.participants),
      null,
    ],
  ]);
  assert.deepEqual(input, expected);
});

test("an existing match retains its timestamp and imported data", async (t) => {
  const client = makeClient();
  t.mock.method(client, "execute", (query: string) =>
    query.startsWith("INSERT")
      ? Promise.resolve({ wasApplied: () => false })
      : Promise.resolve({ first: () => rowFor(makeImportedMatchRecord()) }),
  );
  const input = { ...makeMatchRecord(), parsedAt: "2026-10-19T00:00:00.000Z" };
  const result = await Effect.runPromise(
    makeRepository(client).saveMatch(input),
  );
  assert.deepEqual(result, {
    created: false,
    match: makeImportedMatchRecord(),
  });
});

const invalidRows = [
  ["malformed participant JSON", { participants: "{" }],
  ["wrong participant shape", { participants: "{}" }],
  ["wrong imported-team shape", { imported_teams: "{}" }],
  ["invalid stored timestamp", { parsed_at: new Date("invalid") }],
] as const;

invalidRows.forEach(([name, override]) => {
  test(`${name} reports a stored-data decoding failure`, async (t) => {
    const client = makeClient();
    const { matchId } = makeMatchRecord();
    t.mock.method(client, "execute", () =>
      Promise.resolve({ first: () => rowFor(makeMatchRecord(), override) }),
    );
    const error = await Effect.runPromise(
      Effect.flip(makeRepository(client).findMatch(1, matchId)),
    );
    assert.equal(error._tag, "DatabaseError");
    assert.ok(ParseResult.isParseError(error.cause));
  });
});

const failedQueries = [
  ["write", "INSERT"],
  ["readback", "SELECT"],
] as const;
failedQueries.forEach(([name, prefix]) => {
  test(`a failed match ${name} preserves the driver error`, async (t) => {
    const client = makeClient();
    const cause = new Error(`${name} unavailable`);
    t.mock.method(client, "execute", (query: string) =>
      query.startsWith(prefix)
        ? Promise.reject(cause)
        : Promise.resolve({ wasApplied: () => true }),
    );
    const error = await Effect.runPromise(
      Effect.flip(makeRepository(client).saveMatch(makeMatchRecord())),
    );
    assert.equal(error._tag, "DatabaseError");
    assert.equal(error.cause, cause);
  });
});

test("a match missing after insertion reports a readback failure", async (t) => {
  const client = makeClient();
  t.mock.method(client, "execute", (query: string) =>
    query.startsWith("INSERT")
      ? Promise.resolve({ wasApplied: () => true })
      : Promise.resolve({ first: () => null }),
  );
  const error = await Effect.runPromise(
    Effect.flip(makeRepository(client).saveMatch(makeMatchRecord())),
  );
  assert.equal(error._tag, "DatabaseError");
  assert.ok(error.cause instanceof Error);
  assert.equal(error.cause.message, "Match missing after conditional insert");
});
