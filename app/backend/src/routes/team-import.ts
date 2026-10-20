import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Schema from "effect/Schema";
import type { FastifyPluginAsync } from "fastify";
import { type Match, SeasonNumberSchema } from "../domain.ts";
import {
  decode,
  noBodyErrorHandler,
  registerNoBodyParser,
  respond,
} from "../http.ts";
import { extractPasteText } from "../paste-html.ts";
import { fetchPaste, type PasteFetch } from "../paste-http.ts";
import type { Repository } from "../repository.ts";
import { parseTeamText } from "../team-parser.ts";
import { loadMatch } from "./match.helpers.ts";

export interface ImportDependencies {
  readonly fetch: PasteFetch;
  readonly now: () => Date;
}

export const defaultImportDependencies: ImportDependencies = {
  fetch: (url, options) => globalThis.fetch(url, options),
  now: () => new Date(),
};

const importParticipant = (
  participant: Match["participants"][number],
  fetch: PasteFetch,
) =>
  pipe(
    fetchPaste(participant.pasteUrl, fetch),
    Effect.flatMap(extractPasteText),
    Effect.bindTo("rawText"),
    Effect.bind("pokemon", ({ rawText }) => parseTeamText(rawText)),
    Effect.map(({ rawText, pokemon }) => ({
      teamCode: participant.teamCode,
      playerName: participant.playerName,
      sourceUrl: participant.pasteUrl,
      rawText,
      pokemon,
    })),
  );

const importTeams = (
  repository: Repository,
  match: Match,
  dependencies: ImportDependencies,
) => {
  if (match.importedTeams !== null) return Effect.succeed(match);

  return pipe(
    Effect.all(
      [
        importParticipant(match.participants[0], dependencies.fetch),
        importParticipant(match.participants[1], dependencies.fetch),
      ],
      { concurrency: 2 },
    ),
    Effect.bindTo("participants"),
    Effect.bind("importedAt", () =>
      Effect.sync(() => dependencies.now().toISOString()),
    ),
    Effect.flatMap((teams) =>
      repository.saveImportedTeams(match.seasonNumber, match.matchId, teams),
    ),
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

          Effect.flatMap((match) =>
            importTeams(repository, match, dependencies),
          ),
        ),
        reply,
        200,
      ),
  );
};
