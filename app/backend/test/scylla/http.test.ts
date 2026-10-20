import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import type { Match, Season, UploadReceipt } from "../../src/domain.ts";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "../matches/fixtures.ts";
import { integration, withScylla } from "./helpers.ts";

test("Scylla HTTP workflow: upload, parse, overlapping imports, and repeat preserve saved data", {
  ...integration,
  timeout: 30000,
}, async () => {
  const html = await Promise.all(
    ["tgiS1Swl", "VvVArqgO"].map((id) =>
      readFile(
        new URL(`../fixtures/vrpaste-${id}-complete.html`, import.meta.url),
      ),
    ),
  );
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstRequests = 0;
  let requests = 0;
  let timestamps = 0;

  await withScylla(
    async ({ repository, client, app, createSeason }) => {
      const season = await createSeason();
      const text = `TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)`;
      const upload = await app.inject({
        method: "POST",
        url: `/seasons/${season.seasonNumber}/matches/upload`,
        payload: { text },
      });
      assert.equal(upload.statusCode, 201, upload.body);
      const { uploadId: matchId } = upload.json<UploadReceipt>();
      const parseUrl = `/seasons/${season.seasonNumber}/matches/uploads/${matchId}/parse`;
      const parsed = await app.inject({ method: "POST", url: parseUrl });
      assert.equal(parsed.statusCode, 201, parsed.body);
      const match = parsed.json<Match>();
      assert.deepEqual(match, {
        ...makeMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId,
        uploadId: matchId,
        parsedAt: match.parsedAt,
      });
      assert.ok(Number.isFinite(Date.parse(match.parsedAt)));

      const url = `/seasons/${season.seasonNumber}/matches/${matchId}`;
      const before = await app.inject(url);
      assert.equal(before.statusCode, 200, before.body);
      assert.deepEqual(before.json(), match);
      assert.equal(requests, 0);

      const responses = await Promise.all([
        app.inject({ method: "POST", url: `${url}/teams/import` }),
        app.inject({ method: "POST", url: `${url}/teams/import` }),
      ]);
      responses.forEach((response) => {
        assert.equal(response.statusCode, 200, response.body);
      });

      const saved: Match = responses[0].json();
      assert.deepEqual(responses[1].json(), saved);
      assert.deepEqual({ ...saved, importedTeams: null }, match);
      assert.ok(saved.importedTeams);
      assert.ok(
        ["2026-10-20T12:00:00.000Z", "2026-10-20T12:00:01.000Z"].includes(
          saved.importedTeams.importedAt,
        ),
      );
      assert.equal(saved.importedTeams.participants.length, 2);
      saved.importedTeams.participants.forEach((participant, index) => {
        assert.equal(participant.teamCode, match.participants[index].teamCode);
        assert.equal(
          participant.playerName,
          match.participants[index].playerName,
        );
        assert.equal(participant.sourceUrl, match.participants[index].pasteUrl);
        assert.equal(participant.pokemon.length, 6);
      });
      assert.equal(
        saved.importedTeams.participants[0].pokemon[0].species,
        "Basculegion-F",
      );
      assert.equal(
        saved.importedTeams.participants[1].pokemon[0].species,
        "Mawile",
      );

      const stored = await client.execute(
        "SELECT imported_teams FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, matchId],
        { prepare: true },
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("imported_teams")),
        saved.importedTeams,
      );

      const get = await app.inject(url);
      const reparse = await app.inject({ method: "POST", url: parseUrl });
      const repeat = await app.inject({
        method: "POST",
        url: `${url}/teams/import`,
      });

      assert.equal(get.statusCode, 200);
      assert.deepEqual(get.json(), saved);
      assert.equal(reparse.statusCode, 200, reparse.body);
      assert.deepEqual(reparse.json(), saved);
      assert.equal(repeat.statusCode, 200);
      assert.deepEqual(repeat.json(), saved);
      const original = await Effect.runPromise(
        repository.getUpload(season.seasonNumber, matchId),
      );
      assert.deepEqual(original, { ...upload.json<UploadReceipt>(), text });
      assert.equal(requests, 4);
      assert.equal(timestamps, 2);
    },
    {
      fetch: async (url) => {
        requests += 1;
        const first = url.endsWith("/tgiS1Swl");
        if (first) {
          firstRequests += 1;
          if (firstRequests === 2) release();
          await started;
        }

        return new Response(html[first ? 0 : 1]);
      },
      now: () => new Date(Date.UTC(2026, 9, 20, 12, 0, timestamps++)),
    },
  );
});

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
