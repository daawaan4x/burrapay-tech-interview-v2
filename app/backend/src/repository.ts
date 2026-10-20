import type { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import type {
  DatabaseError,
  DuplicateSeason,
  ImportedTeams,
  Match,
  MatchNotFound,
  MatchSaveResult,
  SavedUpload,
  Season,
  SeasonNotFound,
  UploadNotFound,
  UploadReceipt,
} from "./domain.ts";
import { makeMatchRepository } from "./repository/matches.ts";
import { checkHealth, openClient } from "./repository/scylla.ts";
import { makeSeasonRepository } from "./repository/seasons.ts";
import { makeUploadRepository } from "./repository/uploads.ts";

export interface Repository {
  readonly getSeason: (
    seasonNumber: number,
  ) => Effect.Effect<Season, DatabaseError | SeasonNotFound>;

  readonly listSeasons: () => Effect.Effect<readonly Season[], DatabaseError>;

  readonly createSeason: (
    season: Season,
  ) => Effect.Effect<Season, DatabaseError | DuplicateSeason>;

  readonly getUpload: (
    seasonNumber: number,
    uploadId: string,
  ) => Effect.Effect<SavedUpload, DatabaseError | UploadNotFound>;

  readonly saveUpload: (
    seasonNumber: number,
    text: string,
  ) => Effect.Effect<UploadReceipt, DatabaseError | SeasonNotFound>;

  readonly findMatch: (
    seasonNumber: number,
    matchId: string,
  ) => Effect.Effect<Match | null, DatabaseError>;

  readonly saveMatch: (
    match: Match,
  ) => Effect.Effect<MatchSaveResult, DatabaseError>;

  readonly saveImportedTeams: (
    seasonNumber: number,
    matchId: string,
    importedTeams: ImportedTeams,
  ) => Effect.Effect<Match, DatabaseError | MatchNotFound>;

  readonly health: () => Effect.Effect<void, DatabaseError>;
}

export const makeRepository = (client: Client): Repository => ({
  ...makeSeasonRepository(client),
  ...makeUploadRepository(client),
  ...makeMatchRepository(client),

  health: () => checkHealth(client),
});

export const openRepository = (
  contactPoints: string[],
  localDataCenter: string,
) =>
  pipe(openClient(contactPoints, localDataCenter), Effect.map(makeRepository));
