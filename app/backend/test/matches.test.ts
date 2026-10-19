import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { type TestContext, test } from "node:test";
import * as Effect from "effect/Effect";
import { buildApp } from "../src/app.ts";
import {
  DatabaseError,
  InvalidMatchText,
  type Match,
  SeasonNotFound,
  UploadNotFound,
} from "../src/domain.ts";
import { respond } from "../src/http.ts";
import type { Repository } from "../src/repository.ts";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "./matches.fixtures.ts";

const { matchId, uploadId, parsedAt } = makeMatchRecord();
const getUrl = `/seasons/1/matches/${matchId}`;
const parseUrl = `/seasons/1/matches/uploads/${uploadId}/parse`;

const repository: Repository = {
  createSeason: () => Effect.die("Unexpected season write"),
  listSeasons: () => Effect.die("Unexpected season list"),
  saveUpload: () => Effect.die("Unexpected upload write"),
  getSeason: () =>
    Effect.succeed({
      seasonNumber: 1,
      name: "Season 1",
      teams: { TMA: "Team A", TMB: "Team B" },
    }),
  getUpload: () =>
    Effect.succeed({
      seasonNumber: 1,
      uploadId,
      createdAt: parsedAt,
      text: "Uninterpreted storage fixture",
    }),
  findMatch: () => Effect.succeed(makeImportedMatchRecord()),
  saveMatch: () => Effect.die("Unexpected match write"),
  health: () => Effect.void,
};

const makeApp = (t: TestContext, overrides: Partial<Repository> = {}) => {
  const app = buildApp({ ...repository, ...overrides }, false);
  t.after(() => app.close());
  return app;
};

const storedMatchRequests = [
  ["GET returns the complete stored record", "GET", getUrl],
  ["repeated parse preserves imported data without a write", "POST", parseUrl],
] as const;

storedMatchRequests.forEach(([name, method, url]) => {
  test(name, async (t) => {
    const response = await makeApp(t).inject({ method, url });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), makeImportedMatchRecord());
  });
});

const parseText = `TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: https://www.vrpastes.com/tgiS1Swl
Player B: https://www.vrpastes.com/VvVArqgO`;

const parseOutcomes = [
  ["new match", null, true, 201],
  ["another request already saved the match", null, false, 200],
  ["previously parsed match", makeImportedMatchRecord(), false, 200],
] as const;

parseOutcomes.forEach(([name, found, created, status]) => {
  test(`parse sends one response: ${name}`, async (t) => {
    const expected = created ? makeMatchRecord() : makeImportedMatchRecord();
    const writes: Match[] = [];
    const app = makeApp(t, {
      getUpload: () =>
        Effect.succeed({
          seasonNumber: 1,
          uploadId,
          createdAt: parsedAt,
          text: parseText,
        }),
      findMatch: () => Effect.succeed(found),
      saveMatch: (match) =>
        Effect.sync(() => {
          writes.push(match);
          return { created, match: expected };
        }),
    });
    let sendCount = () => 0;
    app.addHook("onRequest", (_request, reply, done) => {
      const send = t.mock.method(reply, "send");
      sendCount = () => send.mock.callCount();
      done();
    });

    const response = await app.inject({ method: "POST", url: parseUrl });
    assert.equal(response.statusCode, status, response.body);
    assert.deepEqual(response.json(), expected);
    assert.equal(sendCount(), 1);
    assert.equal(writes.length, found ? 0 : 1);
    if (!found) {
      const written = writes[0];
      assert.ok(written);
      assert.equal(new Date(written.parsedAt).toISOString(), written.parsedAt);
      assert.deepEqual(written, {
        ...makeMatchRecord(),
        parsedAt: written.parsedAt,
      });
    }
  });
});

const emptyBodies = [
  ["zero content length", { "content-length": "0" }],
  ["zero-padded content length", { "content-length": "00" }],
  ["empty chunked content", { "transfer-encoding": "chunked" }],
] as const;

emptyBodies.forEach(([name, headers]) => {
  test(`parse accepts ${name} with a JSON content type`, async (t) => {
    const response = await makeApp(t).inject({
      method: "POST",
      url: parseUrl,
      headers: { "content-type": "application/json", ...headers },
    });
    assert.equal(response.statusCode, 200, response.body);
  });
});

const scopedLookups = [
  ["GET", "GET", getUrl.replace("/1/", "/2/")],
  ["parse", "POST", parseUrl.replace("/1/", "/2/")],
] as const;

scopedLookups.forEach(([name, method, url]) => {
  test(`${name} uses the requested season and UUID for lookup`, async (t) => {
    const lookups: unknown[][] = [];
    const app = makeApp(t, {
      getSeason: (seasonNumber) =>
        Effect.succeed({
          seasonNumber,
          name: "Other season",
          teams: { TMA: "Team A" },
        }),
      getUpload: (seasonNumber, requestedId) => {
        lookups.push([seasonNumber, requestedId]);
        return Effect.fail(new UploadNotFound({ uploadId: requestedId }));
      },
      findMatch: (seasonNumber, requestedId) => {
        lookups.push([seasonNumber, requestedId]);
        return Effect.succeed(null);
      },
    });
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(lookups, [[2, matchId]]);
  });
});

const invalidPaths = [
  ["nonpositive season", "GET", getUrl.replace("/1/", "/0/")],
  ["invalid match UUID", "GET", getUrl.replace(matchId, "not-a-uuid")],
  ["fractional season", "POST", parseUrl.replace("/1/", "/1.5/")],
  ["invalid upload UUID", "POST", parseUrl.replace(uploadId, "not-a-uuid")],
] as const;

invalidPaths.forEach(([name, method, url]) => {
  test(`${name} returns 400 before database access`, async (t) => {
    const app = makeApp(t, {
      getSeason: () => Effect.die("Invalid request reached database"),
    });
    const response = await app.inject({ method, url });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(typeof response.json().error, "string");
  });
});

const unexpectedBodies = [
  { name: "a JSON object", payload: "{}" },
  { name: "JSON null", payload: "null" },
  { name: "malformed JSON", payload: "{" },
  {
    name: "chunked JSON null",
    payload: "null",
    headers: { "transfer-encoding": "chunked" },
  },
];

unexpectedBodies.forEach(({ name, payload, headers }) => {
  test(`parse rejects ${name} with 400 before database access`, async (t) => {
    const app = makeApp(t, {
      getSeason: () => Effect.die("Unexpected body reached database"),
    });
    const response = await app.inject({
      method: "POST",
      url: parseUrl,
      headers: { "content-type": "application/json", ...headers },
      payload: headers ? Readable.from([payload]) : payload,
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "This endpoint takes no request body",
    });
  });
});

const missingSeason = (seasonNumber: number) =>
  Effect.fail(new SeasonNotFound({ seasonNumber }));
const missingRecords = [
  ["GET with a missing season", "GET", getUrl, { getSeason: missingSeason }],
  [
    "parse with a missing season",
    "POST",
    parseUrl,
    { getSeason: missingSeason },
  ],
  [
    "parse with a missing upload",
    "POST",
    parseUrl,
    { getUpload: () => Effect.fail(new UploadNotFound({ uploadId })) },
  ],
] as const;

missingRecords.forEach(([name, method, url, overrides]) => {
  test(`${name} returns 404`, async (t) => {
    const response = await makeApp(t, overrides).inject({ method, url });
    assert.equal(response.statusCode, 404);
    assert.equal(typeof response.json().error, "string");
  });
});

["getSeason", "getUpload", "findMatch"].forEach((operation) => {
  test(`a failed ${operation} returns 503 without internal details`, async (t) => {
    const failure = Effect.fail(
      new DatabaseError({ cause: new Error("Private database details") }),
    );
    const app = makeApp(t, { [operation]: () => failure });
    const response = await app.inject({ method: "POST", url: parseUrl });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "Database unavailable" });
  });
});

test("the HTTP responder forwards a tagged content error as 422", async (t) => {
  // HTTP error translation only; no invalid-score input or parser oracle.
  const app = makeApp(t);
  const message = "Content failure from candidate implementation";
  app.get("/tagged-failure", (_request, reply) =>
    respond(Effect.fail(new InvalidMatchText({ message })), reply, 200),
  );
  const response = await app.inject("/tagged-failure");
  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), { error: message });
});
