import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { buildApp } from "../src/app.ts";
import {
  DatabaseError,
  DuplicateSeason,
  type Season,
  SeasonNotFound,
} from "../src/domain.ts";
import type { Repository } from "../src/repository.ts";

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

const repository: Repository = {
  getSeason: () => Effect.succeed(season),
  getUpload: () => Effect.die("Unexpected upload lookup"),
  findMatch: () => Effect.succeed(null),
  saveMatch: () => Effect.die("Unexpected match write"),
  createSeason: (input) => Effect.succeed(input),
  listSeasons: () => Effect.succeed([season]),
  saveUpload: (seasonNumber, rawText) =>
    Effect.sync(() => {
      assert.equal(seasonNumber, 1);
      assert.equal(rawText, text);
      return receipt;
    }),
  health: () => Effect.void,
};

test("preserves the existing root endpoint", (t) => {
  const app = buildApp(repository, false);
  t.after(() => app.close());
  return app.inject("/").then((response) => {
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { message: "Hello from Fastify" });
  });
});

test("creates and lists seasons using the agreed JSON shape", (t) => {
  const app = buildApp(repository, false);
  t.after(() => app.close());
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

test("reports duplicate seasons without overwriting them", (t) => {
  const app = buildApp(
    {
      ...repository,
      createSeason: () => Effect.fail(new DuplicateSeason({ seasonNumber: 1 })),
    },
    false,
  );
  t.after(() => app.close());
  return app
    .inject({ method: "POST", url: "/seasons", payload: season })
    .then((response) => {
      assert.equal(response.statusCode, 409);
      assert.deepEqual(response.json(), { error: "Season 1 already exists" });
    });
});

test("saves decoded upload text exactly, including line endings and links", (t) => {
  const app = buildApp(repository, false);
  t.after(() => app.close());
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
  const app = buildApp(
    {
      ...repository,
      saveUpload: (seasonNumber) =>
        Effect.fail(new SeasonNotFound({ seasonNumber })),
    },
    false,
  );
  t.after(() => app.close());
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
  {},
  { ...season, seasonNumber: 0 },
  { ...season, seasonNumber: -1 },
  { ...season, seasonNumber: 1.5 },
  { ...season, seasonNumber: "1" },
  { ...season, seasonNumber: Number.MAX_SAFE_INTEGER + 1 },
  { ...season, name: " " },
  { ...season, teams: {} },
  { ...season, teams: { "": "Team" } },
  { ...season, teams: { TMA: "" } },
  { ...season, teams: { TMA: 123 } },
  { ...season, unexpected: true },
];

invalidSeasons.map((payload, index) =>
  test(`rejects invalid season input ${index + 1} before persistence`, (t) => {
    const app = buildApp(
      {
        ...repository,
        createSeason: () => Effect.die("Invalid input reached persistence"),
      },
      false,
    );
    t.after(() => app.close());
    return app
      .inject({ method: "POST", url: "/seasons", payload })
      .then((response) => {
        assert.equal(response.statusCode, 400);
        assert.equal(typeof response.json().error, "string");
      });
  }),
);

const invalidUploads = [
  { url: "/seasons/0/matches/upload", payload: { text } },
  { url: "/seasons/1.5/matches/upload", payload: { text } },
  { url: "/seasons/abc/matches/upload", payload: { text } },
  { url: "/seasons/9007199254740992/matches/upload", payload: { text } },
  { url: "/seasons/1/matches/upload", payload: {} },
  { url: "/seasons/1/matches/upload", payload: { text: "" } },
  { url: "/seasons/1/matches/upload", payload: { text: " \r\n\t" } },
  { url: "/seasons/1/matches/upload", payload: { text: 123 } },
  { url: "/seasons/1/matches/upload", payload: { text, extra: true } },
];

invalidUploads.map(({ url, payload }, index) =>
  test(`rejects invalid upload input ${index + 1} before persistence`, (t) => {
    const app = buildApp(
      {
        ...repository,
        saveUpload: () => Effect.die("Invalid input reached persistence"),
      },
      false,
    );
    t.after(() => app.close());
    return app.inject({ method: "POST", url, payload }).then((response) => {
      assert.equal(response.statusCode, 400);
      assert.equal(typeof response.json().error, "string");
    });
  }),
);

test("handles malformed JSON and enforces the body limit", (t) => {
  const app = buildApp(repository, false);
  t.after(() => app.close());
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
  const app = buildApp(
    {
      ...repository,
      createSeason: () => failure,
      listSeasons: () => failure,
      saveUpload: () => failure,
      health: () => failure,
    },
    false,
  );
  t.after(() => app.close());
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
