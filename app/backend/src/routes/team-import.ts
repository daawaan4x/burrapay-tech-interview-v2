import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyPluginAsync } from "fastify";
import {
  CandidateWorkPending,
  type Match,
  MatchNotFound,
  SeasonNumberSchema,
} from "../domain.ts";
import {
  decode,
  noBodyErrorHandler,
  registerNoBodyParser,
  respond,
} from "../http.ts";
import { extractPasteText } from "../paste-html.ts";
import { fetchPaste, type PasteFetch } from "../paste-http.ts";
import type { Repository } from "../repository.ts";

export interface ImportDependencies {
  readonly fetch: PasteFetch;
  readonly now: () => Date;
}

export const defaultImportDependencies: ImportDependencies = {
  fetch: (url, options) => globalThis.fetch(url, options),
  now: () => new Date(),
};

const loadMatch = (
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

const importTeams = (match: Match, fetch: PasteFetch) => {
  if (match.importedTeams !== null) return Effect.succeed(match);

  return pipe(
    Effect.forEach(
      match.participants,
      ({ pasteUrl }) =>
        pipe(fetchPaste(pasteUrl, fetch), Effect.flatMap(extractPasteText)),
      { concurrency: 1, discard: true },
    ),
    // Candidate-owned parsing must be supplied before saving an import.
    Effect.andThen(Effect.fail(new CandidateWorkPending())),
  );
};

export const teamImportRoutes: FastifyPluginAsync<{
  repository: Repository;
  dependencies: ImportDependencies;
}> = async (app, { repository, dependencies }) => {
  registerNoBodyParser(app);

  app.post<{ Params: { seasonNumber: string; matchId: string } }>(
    "/seasons/:seasonNumber/matches/:matchId/teams/import",
    { errorHandler: noBodyErrorHandler },
    (request, reply) =>
      respond(
        pipe(
          Effect.Do,
          Effect.bind("seasonNumber", () =>
            decode(SeasonNumberSchema, request.params.seasonNumber),
          ),
          Effect.bind("matchId", () =>
            decode(Schema.UUID, request.params.matchId),
          ),

          Effect.flatMap(({ seasonNumber, matchId }) =>
            loadMatch(repository, seasonNumber, matchId),
          ),

          Effect.flatMap((match) => importTeams(match, dependencies.fetch)),
        ),
        reply,
        200,
      ),
  );
};
