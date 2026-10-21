import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { createInterface } from "node:readline/promises";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type { Match, Season, UploadReceipt } from "../domain.ts";

const sample = `TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)`;

const request = <A>(
  base: string,
  path: string,
  status = 200,
  method = "GET",
  payload?: unknown,
) =>
  Effect.tryPromise(async () => {
    const body = JSON.stringify(payload);
    const response = await fetch(new URL(path, base), {
      method,
      signal: AbortSignal.timeout(10000),
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body,
    });
    const text = await response.text();

    assert.equal(response.status, status, `${method} ${path}: ${text}`);

    return JSON.parse(text) as A;
  });

const checkBaseline = (url: URL, match: Match) =>
  Effect.try(() => {
    assert.ok(match.importedTeams, "The baseline must contain imported teams");
    assert.equal(match.importedTeams.participants.length, 2);
    assert.ok(
      match.importedTeams.participants.every((team) => team.pokemon.length > 0),
      "Both imported teams must contain Pokemon",
    );

    console.log(`Saved baseline from ${url}:`);
    console.log(JSON.stringify(match, null, 2));
    console.log("Demo records will remain in this season for inspection.");
  });

const waitForRestart = Effect.acquireUseRelease(
  Effect.sync(() =>
    createInterface({ input: process.stdin, output: process.stdout }),
  ),
  (terminal) =>
    Effect.tryPromise(() => {
      const controller = new AbortController();
      terminal.once("close", () => controller.abort());

      return terminal.question(
        "Restart the backend (and optionally Scylla), preserve the database volume, then press Enter when ready: ",
        { signal: controller.signal },
      );
    }),
  (terminal) => Effect.sync(() => terminal.close()),
);

const check = pipe(
  Effect.Do,
  Effect.tap(() =>
    Effect.try(() =>
      assert.ok(
        process.stdin.isTTY,
        "Run this check in an interactive terminal",
      ),
    ),
  ),
  Effect.bind("base", () =>
    Config.string("BASE_URL").pipe(Config.withDefault("http://127.0.0.1:3001")),
  ),

  Effect.bind("season", ({ base }) =>
    request<Season>(base, "/seasons", 201, "POST", {
      seasonNumber: randomInt(1, 2147483647),
      name: "Restart check",
      teams: { TMA: "Team A", TMB: "Team B" },
    }),
  ),
  Effect.let(
    "matchesPath",
    ({ season }) => `/seasons/${season.seasonNumber}/matches`,
  ),

  Effect.bind("upload", ({ base, matchesPath }) =>
    request<UploadReceipt>(base, `${matchesPath}/upload`, 201, "POST", {
      text: sample,
    }),
  ),
  Effect.let(
    "matchPath",
    ({ matchesPath, upload }) => `${matchesPath}/${upload.uploadId}`,
  ),

  Effect.tap(({ base, matchesPath, upload }) =>
    request(
      base,
      `${matchesPath}/uploads/${upload.uploadId}/parse`,
      201,
      "POST",
    ),
  ),
  Effect.tap(({ base, matchPath }) =>
    request(base, `${matchPath}/teams/import`, 200, "POST"),
  ),
  Effect.bind("before", ({ base, matchPath }) =>
    request<Match>(base, matchPath),
  ),

  Effect.tap(({ base, matchPath, before }) =>
    checkBaseline(new URL(matchPath, base), before),
  ),
  Effect.tap(() => waitForRestart),

  Effect.bind("after", ({ base, matchPath }) =>
    request<Match>(base, matchPath),
  ),
  Effect.tap(({ before, after }) =>
    Effect.try(() => {
      assert.deepEqual(after, before, "Saved match changed after the restart");
      console.log("PASS: the imported match is unchanged after your restart.");
    }),
  ),
);

Effect.runPromise(check).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
