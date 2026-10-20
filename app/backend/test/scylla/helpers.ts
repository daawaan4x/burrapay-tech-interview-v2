import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { buildApp } from "../../src/app.ts";
import type { Season } from "../../src/domain.ts";
import { openRepository, type Repository } from "../../src/repository.ts";
import type { ImportDependencies } from "../../src/routes/team-import.ts";

const contactPoints = process.env.SCYLLA_TEST_CONTACT_POINTS;
export const localDataCenter =
  process.env.SCYLLA_LOCAL_DATACENTER ?? "datacenter1";

export const integration = { skip: !contactPoints };

export const cleanupSeasons = async (
  client: Client,
  seasons: readonly number[],
) => {
  const results = await Promise.allSettled(
    seasons.flatMap((seasonNumber) =>
      ["matches", "match_uploads", "seasons"].map((table) =>
        client.execute(
          `DELETE FROM tournament.${table} WHERE season_number = ?`,
          [seasonNumber],
          { prepare: true },
        ),
      ),
    ),
  );
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, "Scylla test cleanup failed");
};

interface ScyllaTest {
  readonly repository: Repository;
  readonly client: Client;
  readonly app: ReturnType<typeof buildApp>;
  readonly createSeason: () => Promise<Season>;
}

// Only resource setup and ownership are shared; each case supplies its behavior.
export const withScylla = (
  run: (context: ScyllaTest) => Promise<void>,
  dependencies?: ImportDependencies,
) =>
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
      Effect.bind("ownedSeasons", ({ client }) =>
        Effect.acquireRelease(
          Effect.sync<number[]>(() => []),
          (seasons) => Effect.promise(() => cleanupSeasons(client, seasons)),
        ),
      ),
      Effect.bind("app", ({ repository }) =>
        Effect.acquireRelease(
          Effect.sync(() => buildApp(repository, false, dependencies)),
          (app) => Effect.promise(() => app.close()),
        ),
      ),
      Effect.flatMap(({ repository, client, app, ownedSeasons }) =>
        Effect.promise(() =>
          run({
            repository,
            client,
            app,
            createSeason: async () => {
              const season: Season = {
                seasonNumber: randomInt(1, 2 ** 48 - 1),
                name: "Integration test season",
                teams: { TMA: "Team A", TMB: "Team B" },
              };
              const response = await app.inject({
                method: "POST",
                url: "/seasons",
                payload: season,
              });
              // Register confirmed ownership before any response assertion can fail.
              if (response.statusCode === 201)
                ownedSeasons.push(season.seasonNumber);
              assert.equal(response.statusCode, 201, response.body);
              assert.deepEqual(response.json(), season);
              return season;
            },
          }),
        ),
      ),
      Effect.scoped,
    ),
  );
