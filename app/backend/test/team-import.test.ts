import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { type TestContext, test } from "node:test";
import * as Effect from "effect/Effect";
import {
  DatabaseError,
  InvalidTeamText,
  type Match,
  PasteTimeout,
  SeasonNotFound,
} from "../src/domain.ts";
import { respond } from "../src/http.ts";
import type { PasteFetch } from "../src/paste-http.ts";
import type { Repository } from "../src/repository.ts";
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
const importedAt = "2026-10-20T12:00:00.000Z";

const makeImportApp = (
  t: TestContext,
  fetch: PasteFetch,
  overrides: Partial<Repository> = {},
) =>
  makeTestApp(
    t,
    {
      getSeason: () => Effect.succeed(season),
      findMatch: () => Effect.succeed(makeMatchRecord()),
      ...overrides,
    },
    { fetch, now: () => new Date(importedAt) },
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

test("the shared HTTP boundary returns team-text failures as 422 with their message", async (t) => {
  const app = makeTestApp(t);
  app.get("/invalid-team", (_request, reply) =>
    respond(
      Effect.fail(new InvalidTeamText({ message: "Team text is invalid" })),
      reply,
      200,
    ),
  );

  const response = await app.inject("/invalid-team");

  assert.equal(response.statusCode, 422);
  assert.deepEqual(response.json(), { error: "Team text is invalid" });
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

test("complete HTML imports sequentially, preserves extracted text, and supports GET and repeat", {
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
  let saved = makeMatchRecord();
  let timestamps = 0;
  const app = makeTestApp(
    t,
    {
      getSeason: () => Effect.succeed(season),
      findMatch: () => Effect.succeed(saved),
      saveImportedTeams: (number, id, teams) =>
        Effect.sync(() => {
          assert.equal(number, 1);
          assert.equal(id, match.matchId);
          saved = { ...saved, importedTeams: teams };

          return saved;
        }),
    },
    {
      fetch: (input) => {
        requested.push(input);

        return Promise.resolve(responses[requested.length - 1]);
      },
      now: () => {
        timestamps += 1;

        return new Date(importedAt);
      },
    },
  );

  const pending = app.inject({ method: "POST", url });
  await writer.write(
    Buffer.from(
      firstHtml
        .toString()
        .replace(">Muddy Water</span>", ">  Muddy Water  </span>"),
    ),
  );

  // Consuming a chunk must not start the next request before this body ends.
  assert.deepEqual(requested, ["https://www.vrpastes.com/tgiS1Swl"]);

  await writer.close();

  const response = await pending;

  assert.equal(response.statusCode, 200, response.body);
  const result: Match = response.json();
  const teams = result.importedTeams;
  assert.ok(teams);
  assert.deepEqual(result, saved);
  assert.deepEqual({ ...result, importedTeams: null }, match);
  assert.equal(teams.importedAt, importedAt);
  assert.equal(teams.participants.length, 2);

  teams.participants.forEach((participant, index) => {
    assert.equal(participant.teamCode, match.participants[index].teamCode);
    assert.equal(participant.playerName, match.participants[index].playerName);
    assert.equal(participant.sourceUrl, match.participants[index].pasteUrl);
    assert.equal(participant.pokemon.length, 6);
    assert.doesNotMatch(participant.rawText, /<|\r/);
  });

  assert.ok(teams.participants[0].rawText.includes("\n-   Muddy Water  \n"));
  assert.deepEqual(teams.participants[0].pokemon[0], {
    species: "Basculegion-F",
    nickname: null,
    item: "Focus Sash",
    ability: "Swift Swim",
    moves: ["Muddy Water", "Protect", "Ice Beam", "Shadow Ball"],
  });
  assert.deepEqual(teams.participants[1].pokemon[0], {
    species: "Mawile",
    nickname: null,
    item: "Mawilite",
    ability: "Hyper Cutter",
    moves: ["Protect", "Sucker Punch", "Play Rough", "Iron Head"],
  });

  const get = await app.inject(url.replace("/teams/import", ""));
  const repeat = await app.inject({ method: "POST", url });

  assert.equal(get.statusCode, 200);
  assert.deepEqual(get.json(), result);
  assert.equal(repeat.statusCode, 200);
  assert.deepEqual(repeat.json(), result);
  assert.equal(timestamps, 1);
  assert.deepEqual(requested, [
    "https://www.vrpastes.com/tgiS1Swl",
    "https://www.vrpastes.com/VvVArqgO",
  ]);
});

test("invalid move content in the first paste returns a parser error as 422", async (t) => {
  const html = (
    await readFile(
      new URL("./fixtures/vrpaste-tgiS1Swl-complete.html", import.meta.url),
    )
  ).toString();
  const invalid = html.replace(">Muddy Water</span>", "> </span>");
  assert.notEqual(invalid, html);

  const app = makeImportApp(t, () => Promise.resolve(new Response(invalid)));
  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 422);
  assert.match(response.json().error, /move/i);
});

test("an import write failure returns a sanitized 503", async (t) => {
  const html = await readFile(
    new URL("./fixtures/vrpaste-tgiS1Swl-complete.html", import.meta.url),
  );
  const app = makeImportApp(t, () => Promise.resolve(new Response(html)), {
    saveImportedTeams: () =>
      Effect.fail(
        new DatabaseError({ cause: new Error("private write detail") }),
      ),
  });

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "Database unavailable" });
});

test("a concurrent import winner is returned from repository readback", async (t) => {
  const html = await readFile(
    new URL("./fixtures/vrpaste-tgiS1Swl-complete.html", import.meta.url),
  );
  const saved = makeImportedMatchRecord();
  const app = makeImportApp(t, () => Promise.resolve(new Response(html)), {
    saveImportedTeams: () => Effect.succeed(saved),
  });

  const response = await app.inject({ method: "POST", url });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), saved);
});

test("candidate-owned: one paste succeeds while the other fails, with nothing persisted", async (t) => {
  
});