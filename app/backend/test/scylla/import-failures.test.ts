import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { integration, withScylla } from "./helpers.ts";

test(
  "candidate-owned: first paste succeeds while the other fails, with nothing persisted",
  integration,
  async () => {
    const html = await readFile(
      new URL("../fixtures/vrpaste-VvVArqgO-complete.html", import.meta.url),
    );

    await withScylla(
      async ({ app, repository, createSeason }) => {
        const season = await createSeason();
        const text = `
TMB vs TMA
Player B vs Player A
Score: 0-2

Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)
Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
`.trim();

        const upload = await Effect.runPromise(
          repository.saveUpload(season.seasonNumber, text),
        );

        const parseResponse = await app.inject({
          method: "POST",
          url: `/seasons/${season.seasonNumber}/matches/uploads/${upload.uploadId}/parse`,
        });
        assert.equal(parseResponse.statusCode, 201, parseResponse.body);

        const match = await Effect.runPromise(
          repository.findMatch(upload.seasonNumber, upload.uploadId),
        );
        assert.equal(match?.importedTeams, null);

        const importResponse = await app.inject({
          method: "POST",
          url: `/seasons/${season.seasonNumber}/matches/${upload.uploadId}/teams/import`,
        });
        assert.equal(
          [422, 502, 504].includes(importResponse.statusCode),
          true,
          importResponse.body,
        );

        const newMatch = await Effect.runPromise(
          repository.findMatch(upload.seasonNumber, upload.uploadId),
        );
        assert.equal(newMatch?.importedTeams, null);
        assert.deepEqual(match, newMatch);
      },
      {
        fetch: (url) => {
          if (url === "https://www.vrpastes.com/VvVArqgO")
            return Promise.resolve(new Response(html));
          return Promise.resolve(new Response(""));
        },
        now: () => new Date(),
      },
    );
  },
);

test(
  "candidate-owned: second paste succeeds while the other fails, with nothing persisted",
  integration,
  async () => {
    const html = await readFile(
      new URL("../fixtures/vrpaste-tgiS1Swl-complete.html", import.meta.url),
    );

    await withScylla(
      async ({ app, repository, createSeason }) => {
        const season = await createSeason();
        const text = `
TMB vs TMA
Player B vs Player A
Score: 0-2

Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)
Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
`.trim();

        const upload = await Effect.runPromise(
          repository.saveUpload(season.seasonNumber, text),
        );

        const parseResponse = await app.inject({
          method: "POST",
          url: `/seasons/${season.seasonNumber}/matches/uploads/${upload.uploadId}/parse`,
        });
        assert.equal(parseResponse.statusCode, 201, parseResponse.body);

        const match = await Effect.runPromise(
          repository.findMatch(upload.seasonNumber, upload.uploadId),
        );
        assert.equal(match?.importedTeams, null);

        const importResponse = await app.inject({
          method: "POST",
          url: `/seasons/${season.seasonNumber}/matches/${upload.uploadId}/teams/import`,
        });
        assert.equal(
          [422, 502, 504].includes(importResponse.statusCode),
          true,
          importResponse.body,
        );

        const newMatch = await Effect.runPromise(
          repository.findMatch(upload.seasonNumber, upload.uploadId),
        );
        assert.equal(newMatch?.importedTeams, null);
        assert.deepEqual(match, newMatch);
      },
      {
        fetch: (url) => {
          if (url === "https://www.vrpastes.com/tgiS1Swl")
            return Promise.resolve(new Response(html));
          return Promise.resolve(new Response(""));
        },
        now: () => new Date(),
      },
    );
  },
);
