import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

const TeamName = Schema.NonEmptyTrimmedString;

export const SeasonSchema = Schema.Struct({
  seasonNumber: Schema.Number.pipe(
    Schema.int(),
    Schema.positive(),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  name: Schema.NonEmptyTrimmedString,
  teams: Schema.Record({
    key: Schema.NonEmptyTrimmedString,
    value: TeamName,
  }).pipe(
    Schema.filter((teams) => Object.keys(teams).length > 0, {
      message: () => "At least one team is required",
    }),
  ),
});

export const SeasonNumberSchema = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const UploadSchema = Schema.Struct({
  text: Schema.String.pipe(
    Schema.filter((text) => text.trim().length > 0, {
      message: () => "Upload text must not be blank",
    }),
  ),
});

export type Season = typeof SeasonSchema.Type;

export interface UploadReceipt {
  readonly uploadId: string;
  readonly seasonNumber: number;
  readonly createdAt: string;
}

export interface SavedUpload extends UploadReceipt {
  readonly text: string;
}

export const MatchParticipantSchema = Schema.Struct({
  teamCode: Schema.String,
  playerName: Schema.String,
  score: Schema.Number,
  pasteUrl: Schema.String,
});

export const MatchParticipantsSchema = Schema.Tuple(
  MatchParticipantSchema,
  MatchParticipantSchema,
);

const PokemonRecordSchema = Schema.Struct({
  species: Schema.String,
  nickname: Schema.NullOr(Schema.String),
  item: Schema.NullOr(Schema.String),
  ability: Schema.String,
  moves: Schema.Array(Schema.String),
});

const ImportedParticipantSchema = Schema.Struct({
  teamCode: Schema.String,
  playerName: Schema.String,
  sourceUrl: Schema.String,
  rawText: Schema.String,
  pokemon: Schema.Array(PokemonRecordSchema),
});

export const ImportedTeamsSchema = Schema.Struct({
  importedAt: Schema.String,
  participants: Schema.Tuple(
    ImportedParticipantSchema,
    ImportedParticipantSchema,
  ),
});

export const MatchSchema = Schema.Struct({
  matchId: Schema.UUID,
  uploadId: Schema.UUID,
  seasonNumber: SeasonSchema.fields.seasonNumber,
  participants: MatchParticipantsSchema,
  winnerTeamCode: Schema.String,
  parsedAt: Schema.String,
  importedTeams: Schema.NullOr(ImportedTeamsSchema),
});

export type Match = typeof MatchSchema.Type;

export interface MatchSaveResult {
  readonly match: Match;
  readonly created: boolean;
}

export class InvalidInput extends Data.TaggedError("InvalidInput")<{
  readonly message: string;
}> {}

export class DuplicateSeason extends Data.TaggedError("DuplicateSeason")<{
  readonly seasonNumber: number;
}> {}

export class SeasonNotFound extends Data.TaggedError("SeasonNotFound")<{
  readonly seasonNumber: number;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown;
}> {}

export class UploadNotFound extends Data.TaggedError("UploadNotFound")<{
  readonly uploadId: string;
}> {}

export class MatchNotFound extends Data.TaggedError("MatchNotFound")<{
  readonly matchId: string;
}> {}

export class InvalidMatchText extends Data.TaggedError("InvalidMatchText")<{
  readonly message: string;
}> {}