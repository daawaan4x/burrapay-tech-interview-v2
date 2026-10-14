import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { test } from "node:test";
import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { buildApp } from "../src/app.ts";
import type { UploadReceipt } from "../src/domain.ts";
import { openRepository } from "../src/repository.ts";

const contactPoints = process.env.SCYLLA_TEST_CONTACT_POINTS;
const localDataCenter = process.env.SCYLLA_LOCAL_DATACENTER ?? "datacenter1";

test(
  "Scylla integration: seasons, duplicates, raw uploads, and database readback",
  { skip: !contactPoints },
  () =>
    Effect.runPromise(
      pipe(
        Effect.Do,
        Effect.bind("repository", () =>
          openRepository(
            (contactPoints ?? "127.0.0.1").split(","),
            localDataCenter,
          ),
        ),
        Effect.bind("client", () =>
          pipe(
            Effect.acquireRelease(
              Effect.sync(
                () =>
                  new Client({
                    contactPoints: (contactPoints ?? "127.0.0.1").split(","),
                    localDataCenter,
                  }),
              ),
              (client) => Effect.promise(() => client.shutdown()),
            ),
            Effect.tap((client) => Effect.promise(() => client.connect())),
          ),
        ),
        Effect.bind("app", ({ repository }) =>
          Effect.acquireRelease(
            Effect.sync(() => buildApp(repository, false)),
            (app) => Effect.promise(() => app.close()),
          ),
        ),
        Effect.bind("season", () =>
          Effect.sync(() => ({
            seasonNumber: randomInt(1, 2 ** 48 - 1),
            name: "Integration test season",
            teams: { TMA: "Team A", TMB: "Team B" },
          })),
        ),
        Effect.bind("savedSeason", ({ app, client, season }) =>
          Effect.acquireRelease(
            Effect.promise(() =>
              app
                .inject({ method: "POST", url: "/seasons", payload: season })
                .then((response) => {
                  assert.equal(response.statusCode, 201, response.body);
                  assert.deepEqual(response.json(), season);
                  return season;
                }),
            ),
            () =>
              pipe(
                Effect.promise(() =>
                  client.execute(
                    "DELETE FROM tournament.match_uploads WHERE season_number = ?",
                    [season.seasonNumber],
                    { prepare: true },
                  ),
                ),
                Effect.andThen(
                  Effect.promise(() =>
                    client.execute(
                      "DELETE FROM tournament.seasons WHERE season_number = ?",
                      [season.seasonNumber],
                      { prepare: true },
                    ),
                  ),
                ),
                Effect.asVoid,
              ),
          ),
        ),
        Effect.tap(({ app, season }) =>
          Effect.promise(() =>
            app
              .inject({
                method: "POST",
                url: "/seasons",
                payload: { ...season, name: "Must not overwrite" },
              })
              .then((response) => assert.equal(response.statusCode, 409)),
          ),
        ),
        Effect.tap(({ app, season }) =>
          Effect.promise(() =>
            app.inject("/seasons").then((response) => {
              assert.equal(response.statusCode, 200);
              const seasons =
                response.json<
                  {
                    seasonNumber: number;
                    name: string;
                    teams: Record<string, string>;
                  }[]
                >();
              assert.deepEqual(
                seasons.find(
                  (entry) => entry.seasonNumber === season.seasonNumber,
                ),
                season,
              );
            }),
          ),
        ),
        Effect.bind("text", () =>
          Effect.succeed(
            "  TMA vs TMB\r\nPlayer A vs Player B\nScore: 2-0\n\nPlayer A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)\nPlayer B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)\n",
          ),
        ),
        Effect.bind("receipt", ({ app, season, text }) =>
          Effect.promise(() =>
            app
              .inject({
                method: "POST",
                url: `/seasons/${season.seasonNumber}/matches/upload`,
                payload: { text },
              })
              .then((response) => {
                assert.equal(response.statusCode, 201, response.body);
                return response.json<UploadReceipt>();
              }),
          ),
        ),
        Effect.tap(({ client, season, receipt, text }) =>
          Effect.promise(() =>
            client
              .execute(
                `SELECT raw_text, created_at FROM tournament.match_uploads
                 WHERE season_number = ? AND upload_id = ?`,
                [season.seasonNumber, receipt.uploadId],
                { prepare: true },
              )
              .then((result) => {
                assert.equal(result.first().get("raw_text"), text);
                assert.deepEqual(
                  result.first().get("created_at"),
                  new Date(receipt.createdAt),
                );
                assert.equal(receipt.seasonNumber, season.seasonNumber);
              }),
          ),
        ),
        Effect.asVoid,
        Effect.scoped,
      ),
    ),
);
