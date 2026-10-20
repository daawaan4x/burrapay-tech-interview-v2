import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { MatchNotFound } from "../domain.ts";
import type { Repository } from "../repository.ts";

export const loadMatch = (
  repository: Repository,
  seasonNumber: number,
  matchId: string,
) =>
  pipe(
    repository.getSeason(seasonNumber),
    Effect.flatMap(() => repository.findMatch(seasonNumber, matchId)),
    Effect.filterOrFail(
      (match) => match !== null,
      () => new MatchNotFound({ matchId }),
    ),
  );
