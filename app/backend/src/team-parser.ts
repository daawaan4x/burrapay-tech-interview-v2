import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { InvalidTeamText, type PokemonRecord } from "./domain.ts";

const invalid = (message: string) => new InvalidTeamText({ message });

const NICKNAME_PATTERN = /(.+) +\(([^)]*)\)?/;
const parseName = (name: string) =>
  pipe(
    Effect.succeed(name),
    Effect.map((name) => {
      if (name.endsWith("(M)") || name.endsWith("(F)"))
        name = name.slice(0, name.length - 3).trim();

      const result = NICKNAME_PATTERN.exec(name);
      if (result === null) return { species: name, nickname: null };
      return { species: result[2], nickname: result[1] };
    }),

    Effect.filterOrFail(
      ({ species }) => species.length > 0,
      () => invalid("Expected non-empty species name"),
    ),
  );

const parseNameLine = (line: string) =>
  pipe(
    Effect.Do,
    Effect.filterOrFail(
      () => !line.includes(":") && !line.startsWith("-"),
      () =>
        invalid(
          'Expected name line format to be one of: "Species @ Item?", "Nickname (Species) @ Item?". Nickname and Item is optional',
        ),
    ),
    Effect.let("parts", () => line.split("@").map((parts) => parts.trim())),
    Effect.filterOrFail(
      ({ parts }) => parts.length <= 2,
      ({ parts }) =>
        invalid(`Expected zero or one "@", found ${parts.length - 1}`),
    ),
    Effect.let("item", ({ parts }) => parts[1] || null),
    Effect.bind("name", ({ parts }) => parseName(parts[0])),
    Effect.map(({ item, name }) => ({ item, ...name })),
  );

const METADATA_PATTERN = /(.+): +(.*)/;
const METADATA_LABELS = [
  "Ability",
  "Level",
  "Shiny",
  "Happiness",
  "EVs",
  "IVs",
  "Tera Type",
];
const parseMetadata = (lines: string[]) =>
  pipe(
    Effect.succeed(
      lines
        .map((line) => METADATA_PATTERN.exec(line))
        .filter(Boolean)
        // biome-ignore lint/style/noNonNullAssertion: filter(Boolean) above
        .map((result) => ({ label: result![1], value: result![2] })),
    ),
    Effect.filterOrFail(
      (lines) => lines.every((line) => METADATA_LABELS.includes(line.label)),
      () =>
        invalid(
          `Expected metadata labels to only be one of ${METADATA_LABELS.join(",")}`,
        ),
    ),
    Effect.filterOrFail(
      (lines) => lines.filter((line) => line.label === "Ability").length === 1,
      (lines) =>
        invalid(
          `Expected 1 ability specified, found ${lines.filter((line) => line.label === "Ability").length}`,
        ),
    ),
  );

const parseMoves = (lines: string[]) =>
  pipe(
    Effect.succeed(
      lines.filter((line) => line.startsWith("-")).map((line) => line.trim()),
    ),
    Effect.filterOrFail(
      (lines) => lines.every((line) => line.length > 1),
      (lines) =>
        invalid(
          `Expected no moves, found ${lines.filter((line) => line.length === 1).length}`,
        ),
    ),
    Effect.filterOrFail(
      (lines) => 1 <= lines.length && lines.length <= 4,
      (lines) => invalid(`Expected 1-4 moves, found ${lines.length}`),
    ),
    Effect.map((lines) => lines.map((line) => line.slice(1).trim())),
  );

const parseNature = (lines: string[]) =>
  Effect.succeed(lines.filter((line) => line.endsWith(" Nature")));

const parsePokemonText = (text: string) =>
  pipe(
    Effect.Do,
    Effect.let("lines", () => text.split(/\r?\n/).map((line) => line.trim())),
    Effect.bind("nameLine", ({ lines }) => parseNameLine(lines[0])),
    Effect.bind("metadata", ({ lines }) => parseMetadata(lines)),
    Effect.bind("moves", ({ lines }) => parseMoves(lines)),
    Effect.bind("nature", ({ lines }) => parseNature(lines)),

    Effect.filterOrFail(
      ({ lines, metadata, moves, nature }) =>
        lines.length === 1 + metadata.length + moves.length + nature.length,
      () => invalid("Unrecognized lines are present in the team text"),
    ),

    Effect.map(
      ({ nameLine, metadata, moves }) =>
        ({
          species: nameLine.species,
          nickname: nameLine.nickname,
          item: nameLine.item,
          // biome-ignore lint/style/noNonNullAssertion: filtered above
          ability: metadata.find((meta) => meta.label === "Ability")!.value,
          moves,
        }) satisfies PokemonRecord,
    ),
  );

export const parseTeamText = (text: string) =>
  pipe(
    Effect.succeed(
      text
        .split(/\r?\n\s*\r?\n/)
        .map((block) => block.trim())
        .filter(Boolean),
    ),
    Effect.filterOrFail(
      (blocks) => 1 <= blocks.length && blocks.length <= 6,
      (blocks) =>
        invalid(`Expected 1-6 pokemons in a team, found ${blocks.length}`),
    ),
    Effect.flatMap((blocks) => Effect.all(blocks.map(parsePokemonText))),
  );

export const serializeTeamText = (records: PokemonRecord[]) =>
  Effect.succeed(() =>
    records.map((r) =>
      [
        `${r.nickname ? `${r.nickname} (${r.species})` : r.species} @ ${r.item}`,
        `Ability: ${r.ability}`,
        ...r.moves.map((move) => `- ${move}`),
      ].join("\n"),
    ),
  );
