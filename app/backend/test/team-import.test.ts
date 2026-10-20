import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import * as Effect from "effect/Effect";
import { DatabaseError, PasteTimeout, SeasonNotFound } from "../src/domain.ts";
import { respond } from "../src/http.ts";
import type { PasteFetch } from "../src/paste-http.ts";
import { makeTestApp } from "./http.helpers.ts";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "./matches.fixtures.ts";

const match = makeMatchRecord();
const url = `/seasons/1/matches/${match.matchId}/teams/import`;
const season = {
  seasonNumber: 1,
  name: "Season",
  teams: { TMA: "A", TMB: "B" },
};

const makeImportApp = (t: TestContext, fetch: PasteFetch) =>
  makeTestApp(
    t,
    {
      getSeason: () => Effect.succeed(season),
      findMatch: () => Effect.succeed(makeMatchRecord()),
    },
    { fetch },
  );

test("the shared HTTP boundary translates paste timeouts to 504", async (t) => {
  const app = makeTestApp(t);
  app.get("/timeout", (_request, reply) =>
    respond(Effect.fail(new PasteTimeout()), reply, 200),
  );

  const response = await app.inject("/timeout");

  assert.equal(response.statusCode, 504);
  assert.deepEqual(response.json(), { error: "Paste request timed out" });
});

["0", "1.5", "9007199254740992", "invalid"].forEach((number) => {
  test(`import rejects invalid season ${number} before lookups`, async (t) => {
    const response = await makeTestApp(t).inject({
      method: "POST",
      url: url.replace("/1/", `/${number}/`),
    });

    assert.equal(response.statusCode, 400);
    assert.equal(typeof response.json().error, "string");
  });
});

test("import rejects invalid match UUIDs before lookups", async (t) => {
  const response = await makeTestApp(t).inject({
    method: "POST",
    url: url.replace(match.matchId, "invalid"),
  });

  assert.equal(response.statusCode, 400);
});

[{}, "x", "null"].forEach((payload) => {
  test(`import rejects a supplied body ${JSON.stringify(payload)}`, async (t) => {
    const response = await makeTestApp(t).inject({
      method: "POST",
      url,
      payload,
      headers: { "content-type": "application/json" },
    });

    assert.equal(response.statusCode, 400);
    assert.match(response.json().error, /no request body/);
  });
});

test("import reports a missing season before loading a match", async (t) => {
  const app = makeTestApp(t, {
    getSeason: () => Effect.fail(new SeasonNotFound({ seasonNumber: 1 })),
  });

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 404);
  assert.match(response.json().error, /Season/);
});

test("import only looks up a match in the requested season", async (t) => {
  const app = makeTestApp(t, {
    getSeason: (number) => {
      assert.equal(number, 2);
      return Effect.succeed({ ...season, seasonNumber: 2 });
    },
    findMatch: (number, id) => {
      assert.equal(number, 2);
      assert.equal(id, match.matchId);
      return Effect.succeed(null);
    },
  });

  const response = await app.inject({
    method: "POST",
    url: url.replace("/1/", "/2/"),
  });

  assert.equal(response.statusCode, 404);
  assert.match(response.json().error, /Match/);
});

test("import returns saved data and GET agrees without fetching or taking a timestamp", async (t) => {
  const saved = makeImportedMatchRecord();
  const app = makeTestApp(t, {
    getSeason: () => Effect.succeed(season),
    findMatch: () => Effect.succeed(saved),
  });

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), saved);

  const get = await app.inject(url.replace("/teams/import", ""));

  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.json(), saved);
});

test("an import database lookup failure returns a sanitized 503", async (t) => {
  const app = makeTestApp(t, {
    getSeason: () =>
      Effect.fail(
        new DatabaseError({ cause: new Error("private driver detail") }),
      ),
  });

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "Database unavailable" });
});

test("an upstream non-success status maps to 502", async (t) => {
  const app = makeImportApp(t, () =>
    Promise.resolve(new Response("Unavailable", { status: 503 })),
  );

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 502);
  assert.match(response.json().error, /503/);
});

test("raw HTML at the fetch boundary produces a meaningful extraction error", async (t) => {
  const raw = await readFile(
    new URL("./fixtures/vrpaste-raw.html", import.meta.url),
  );
  const app = makeImportApp(t, () => Promise.resolve(new Response(raw)));

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /extract team text/);
});

test("complete HTML is fetched sequentially, then stops at candidate-owned parsing", {
  timeout: 5000,
}, async (t) => {
  const firstHtml = await readFile(
    new URL("./fixtures/vrpaste-tgiS1Swl-complete.html", import.meta.url),
  );
  const secondHtml = await readFile(
    new URL("./fixtures/vrpaste-VvVArqgO-complete.html", import.meta.url),
  );
  const firstBody = new TransformStream<Uint8Array, Uint8Array>();
  const writer = firstBody.writable.getWriter();
  t.after(() => writer.abort());

  const responses = [
    new Response(firstBody.readable),
    new Response(secondHtml),
  ];
  const requested: string[] = [];
  const app = makeImportApp(t, (input) => {
    requested.push(input);

    return Promise.resolve(responses[requested.length - 1]);
  });

  const pending = app.inject({ method: "POST", url });
  await writer.write(firstHtml);

  // Consuming a chunk must not start the next request before this body ends.
  assert.deepEqual(requested, ["https://www.vrpastes.com/tgiS1Swl"]);

  await writer.close();

  const response = await pending;

  assert.equal(response.statusCode, 501);
  assert.match(response.json().error, /not implemented/);
  assert.deepEqual(requested, [
    "https://www.vrpastes.com/tgiS1Swl",
    "https://www.vrpastes.com/VvVArqgO",
  ]);
});
