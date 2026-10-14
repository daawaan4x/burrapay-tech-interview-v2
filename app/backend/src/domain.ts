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
