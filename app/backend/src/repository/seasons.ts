import type { Client, types } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import {
  DatabaseError,
  DuplicateSeason,
  type Season,
  SeasonNotFound,
  SeasonSchema,
} from "../domain.ts";
import type { Repository } from "../repository.ts";
import { database } from "./scylla.ts";

const decodeSeason = (row: types.Row) =>
  pipe(
    Schema.decodeUnknown(SeasonSchema)({
      seasonNumber: Number(row.get("season_number")),
      name: row.get("name"),
      teams: row.get("teams"),
    }),
    Effect.mapError((cause) => new DatabaseError({ cause })),
  );

const readSeasons = (
  client: Client,
  pageState?: string,
): Effect.Effect<readonly Season[], DatabaseError> =>
  pipe(
    Effect.Do,
    Effect.bind("result", () =>
      database(() =>
        client.execute(
          "SELECT season_number, name, teams FROM tournament.seasons",
          [],
          { prepare: true, pageState },
        ),
      ),
    ),

    Effect.bind("seasons", ({ result }) =>
      Effect.forEach(result.rows, decodeSeason),
    ),
    Effect.flatMap(({ result, seasons }) =>
      result.pageState
        ? pipe(
            Effect.suspend(() => readSeasons(client, result.pageState)),
            Effect.map((nextSeasons) => [...seasons, ...nextSeasons]),
          )
        : Effect.succeed(seasons),
    ),
  );

export const makeSeasonRepository = (
  client: Client,
): Pick<Repository, "getSeason" | "listSeasons" | "createSeason"> => ({
  getSeason: (seasonNumber) =>
    pipe(
      database(() =>
        client.execute(
          "SELECT season_number, name, teams FROM tournament.seasons WHERE season_number = ?",
          [seasonNumber],
          { prepare: true },
        ),
      ),
      Effect.flatMap(
        (result): Effect.Effect<Season, DatabaseError | SeasonNotFound> => {
          const row = result.first();

          return row
            ? decodeSeason(row)
            : Effect.fail(new SeasonNotFound({ seasonNumber }));
        },
      ),
    ),

  listSeasons: () =>
    pipe(
      readSeasons(client),
      Effect.map((seasons) =>
        seasons.toSorted((a, b) => a.seasonNumber - b.seasonNumber),
      ),
    ),

  createSeason: (season) =>
    pipe(
      database(() =>
        client.execute(
          `INSERT INTO tournament.seasons (season_number, name, teams)
           VALUES (?, ?, ?) IF NOT EXISTS`,
          [season.seasonNumber, season.name, season.teams],
          { prepare: true },
        ),
      ),
      Effect.flatMap((result) =>
        result.wasApplied()
          ? Effect.succeed(season)
          : Effect.fail(
              new DuplicateSeason({ seasonNumber: season.seasonNumber }),
            ),
      ),
    ),
});
