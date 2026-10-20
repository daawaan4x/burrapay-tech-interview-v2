import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import {
  makeImportedMatchRecord,
  makeMatchRecord,
} from "../matches/fixtures.ts";
import { integration, withScylla } from "./helpers.ts";

test(
  "Scylla imports: concurrent updates preserve one complete import and its match",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const matchId = randomUUID();
      const match = {
        ...makeMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId,
        uploadId: matchId,
      };

      await Effect.runPromise(repository.saveMatch(match));

      const first = makeImportedMatchRecord().importedTeams;
      assert.ok(first);

      const second = {
        ...structuredClone(first),
        importedAt: "2026-10-20T00:00:00.000Z",
        participants: [
          {
            ...first.participants[0],
            rawText: "Alternate opaque storage text A",
          },
          {
            ...first.participants[1],
            rawText: "Alternate opaque storage text B",
          },
        ] as const,
      };

      const results = await Effect.runPromise(
        Effect.all(
          [first, second].map((teams) =>
            repository.saveImportedTeams(season.seasonNumber, matchId, teams),
          ),
          { concurrency: 2 },
        ),
      );
      const winner = results[0];

      assert.deepEqual(results[1], winner);
      assert.ok(
        [first.importedAt, second.importedAt].includes(
          winner.importedTeams?.importedAt ?? "",
        ),
      );
      assert.deepEqual(
        winner.importedTeams,
        winner.importedTeams?.importedAt === first.importedAt ? first : second,
      );
      assert.deepEqual({ ...winner, importedTeams: null }, match);

      const stored = await client.execute(
        "SELECT imported_teams, participants, parsed_at FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, matchId],
        { prepare: true },
      );

      assert.deepEqual(
        JSON.parse(stored.first().get("imported_teams")),
        winner.importedTeams,
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("participants")),
        match.participants,
      );
      assert.deepEqual(
        stored.first().get("parsed_at"),
        new Date(match.parsedAt),
      );

      const repeated = await Effect.runPromise(
        repository.saveImportedTeams(season.seasonNumber, matchId, second),
      );

      assert.deepEqual(repeated, winner);
    }),
);

test(
  "Scylla imports: a missing match is not created by an import update",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const missingId = randomUUID();
      const teams = makeImportedMatchRecord().importedTeams;
      assert.ok(teams);

      const error = await Effect.runPromise(
        Effect.flip(
          repository.saveImportedTeams(season.seasonNumber, missingId, teams),
        ),
      );

      assert.equal(error._tag, "MatchNotFound");

      const missing = await client.execute(
        "SELECT * FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, missingId],
        { prepare: true },
      );

      assert.equal(missing.rowLength, 0);
    }),
);

test(
  "Scylla storage: overlapping saves return one winning record and preserve it on repeat",
  integration,
  () =>
    withScylla(async ({ repository, client, createSeason }) => {
      const season = await createSeason();
      const upload = await Effect.runPromise(
        repository.saveUpload(season.seasonNumber, "Opaque storage fixture"),
      );
      // Already structured setup; no parser, fetch, or live import runs here.
      const first = {
        ...makeImportedMatchRecord(),
        seasonNumber: season.seasonNumber,
        matchId: upload.uploadId,
        uploadId: upload.uploadId,
      };
      const second = {
        ...structuredClone(first),
        parsedAt: "2026-10-19T00:00:00.000Z",
      };
      const results = await Effect.runPromise(
        Effect.all(
          [repository.saveMatch(first), repository.saveMatch(second)],
          { concurrency: 2 },
        ),
      );
      assert.equal(results.filter((result) => result.created).length, 1);
      const winner = results.find((result) => result.created);
      assert.ok(winner);
      assert.ok(
        [first.parsedAt, second.parsedAt].includes(winner.match.parsedAt),
      );
      results.forEach((result) => {
        assert.deepEqual(result.match, winner.match);
      });

      const stored = await client.execute(
        "SELECT parsed_at, participants, imported_teams FROM tournament.matches WHERE season_number = ? AND match_id = ?",
        [season.seasonNumber, upload.uploadId],
        { prepare: true },
      );
      assert.equal(stored.rowLength, 1);
      assert.deepEqual(
        stored.first().get("parsed_at"),
        new Date(winner.match.parsedAt),
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("participants")),
        makeImportedMatchRecord().participants,
      );
      assert.deepEqual(
        JSON.parse(stored.first().get("imported_teams")),
        makeImportedMatchRecord().importedTeams,
      );
      const repeated = await Effect.runPromise(
        repository.saveMatch({
          ...first,
          importedTeams: null,
          parsedAt: "2026-10-19T01:00:00.000Z",
        }),
      );
      assert.deepEqual(repeated, { created: false, match: winner.match });
    }),
);
