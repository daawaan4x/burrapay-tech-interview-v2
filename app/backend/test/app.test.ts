import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import * as Effect from "effect/Effect";
import {
  DatabaseError,
  DuplicateSeason,
  type Season,
  SeasonNotFound,
} from "../src/domain.ts";
import type { Repository } from "../src/repository.ts";
import { makeTestApp } from "./http.helpers.ts";

const season: Season = {
  seasonNumber: 1,
  name: "Season 1",
  teams: { TMA: "Team A", TMB: "Team B" },
};

const text =
  "TMA vs TMB\nPlayer A vs Player B\nScore: 2-0\n\nPlayer A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)\nPlayer B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)\n";

const receipt = {
  uploadId: "05b69234-60e2-42e5-91aa-096bcae239d0",
  seasonNumber: 1,
  createdAt: "2026-10-14T00:00:00.000Z",
};

const makeApp = (t: TestContext, overrides: Partial<Repository> = {}) =>
  makeTestApp(t, {
    createSeason: (input) => Effect.succeed(input),
    listSeasons: () => Effect.succeed([season]),
    saveUpload: (seasonNumber, rawText) =>
      Effect.sync(() => {
        assert.equal(seasonNumber, 1);
        assert.equal(rawText, text);
        return receipt;
      }),
    ...overrides,
  });

test("preserves the existing root endpoint", (t) => {
  const app = makeApp(t);
  return app.inject("/").then((response) => {
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { message: "Hello from Fastify" });
  });
});

test("creates and lists seasons using the agreed JSON shape", (t) => {
  const app = makeApp(t);
  return app
    .inject({ method: "POST", url: "/seasons", payload: season })
    .then((response) => {
      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json(), season);
      return app.inject("/seasons");
    })
    .then((response) => {
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), [season]);
    });
});

test("a duplicate-season error returns 409", (t) => {
  const app = makeApp(t, {
    createSeason: () => Effect.fail(new DuplicateSeason({ seasonNumber: 1 })),
  });
  return app
    .inject({ method: "POST", url: "/seasons", payload: season })
    .then((response) => {
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), { error: "Season 1 already exists" });
    });
});

test("upload forwards decoded text unchanged and returns the repository receipt", (t) => {
  const app = makeApp(t);
  return app
    .inject({
      method: "POST",
      url: "/seasons/1/matches/upload",
      payload: { text },
    })
    .then((response) => {
      assert.equal(response.statusCode, 201);
      assert.deepEqual(response.json(), receipt);
    });
});

test("rejects uploads for an unknown season", (t) => {
  const app = makeApp(t, {
    saveUpload: (seasonNumber) =>
      Effect.fail(new SeasonNotFound({ seasonNumber })),
  });
  return app
    .inject({
      method: "POST",
      url: "/seasons/2/matches/upload",
      payload: { text },
    })
    .then((response) => {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: "Season 2 not found" });
    });
});

const invalidSeasons = [
  ["missing fields", {}],
  ["a zero season number", { ...season, seasonNumber: 0 }],
  ["a negative season number", { ...season, seasonNumber: -1 }],
  ["a fractional season number", { ...season, seasonNumber: 1.5 }],
  ["a string season number", { ...season, seasonNumber: "1" }],
  [
    "an unsafe season number",
    { ...season, seasonNumber: Number.MAX_SAFE_INTEGER + 1 },
  ],
  ["a blank season name", { ...season, name: " " }],
  ["no teams", { ...season, teams: {} }],
  ["an empty team code", { ...season, teams: { "": "Team" } }],
  ["an empty team name", { ...season, teams: { TMA: "" } }],
  ["a non-string team name", { ...season, teams: { TMA: 123 } }],
  ["unknown season fields", { ...season, unexpected: true }],
] as const;

invalidSeasons.forEach(([name, payload]) => {
  test(`season creation rejects ${name} before persistence`, (t) => {
    const app = makeApp(t, {
      createSeason: () => Effect.die("Invalid input reached persistence"),
    });
    return app
      .inject({ method: "POST", url: "/seasons", payload })
      .then((response) => {
        assert.equal(response.statusCode, 400);
        assert.equal(typeof response.json().error, "string");
      });
  });
});

const uploadUrl = "/seasons/1/matches/upload";
const invalidUploads = [
  ["a zero season number", "/seasons/0/matches/upload", { text }],
  ["a fractional season number", "/seasons/1.5/matches/upload", { text }],
  ["a nonnumeric season number", "/seasons/abc/matches/upload", { text }],
  [
    "an unsafe season number",
    "/seasons/9007199254740992/matches/upload",
    { text },
  ],
  ["missing text", uploadUrl, {}],
  ["empty text", uploadUrl, { text: "" }],
  ["whitespace-only text", uploadUrl, { text: " \r\n\t" }],
  ["non-string text", uploadUrl, { text: 123 }],
  ["unknown upload fields", uploadUrl, { text, extra: true }],
] as const;

invalidUploads.forEach(([name, url, payload]) => {
  test(`upload rejects ${name} before persistence`, (t) => {
    const app = makeApp(t, {
      saveUpload: () => Effect.die("Invalid input reached persistence"),
    });
    return app.inject({ method: "POST", url, payload }).then((response) => {
      assert.equal(response.statusCode, 400);
      assert.equal(typeof response.json().error, "string");
    });
  });
});

test("handles malformed JSON and enforces the body limit", (t) => {
  const app = makeApp(t);
  return app
    .inject({
      method: "POST",
      url: "/seasons",
      headers: { "content-type": "application/json" },
      payload: "{",
    })
    .then((response) => {
      assert.equal(response.statusCode, 400);
      return app.inject({
        method: "POST",
        url: "/seasons/1/matches/upload",
        payload: { text: "a".repeat(1024 * 1024) },
      });
    })
    .then((response) => assert.equal(response.statusCode, 413));
});

test("database failures return 503 instead of success or an empty list", (t) => {
  const failure = Effect.fail(
    new DatabaseError({ cause: new Error("Database offline") }),
  );
  const app = makeApp(t, {
    createSeason: () => failure,
    listSeasons: () => failure,
    saveUpload: () => failure,
    health: () => failure,
  });
  return Promise.all(
    [
      { method: "POST" as const, url: "/seasons", payload: season },
      { method: "GET" as const, url: "/seasons" },
      {
        method: "POST" as const,
        url: "/seasons/1/matches/upload",
        payload: { text },
      },
      { method: "GET" as const, url: "/health" },
    ].map((request) =>
      app.inject(request).then((response) => {
        assert.equal(response.statusCode, 503);
        assert.deepEqual(response.json(), { error: "Database unavailable" });
      }),
    ),
  ).then(() => undefined);
});
