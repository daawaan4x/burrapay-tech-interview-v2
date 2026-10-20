import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Effect from "effect/Effect";
import { InvalidTeamText, type PokemonRecord } from "../../src/domain.ts";
import { parseTeamText } from "../../src/team-parser.ts";

const minimalTeam = "Pikachu\nAbility: Static\n- Thunderbolt";
const pikachu: PokemonRecord = {
  species: "Pikachu",
  nickname: null,
  item: null,
  ability: "Static",
  moves: ["Thunderbolt"],
};

const sample = `Sparky (Pikachu) @ Light Ball
Ability: Static
Level: 50
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Thunderbolt
- Volt Switch
- Grass Knot
- Protect

Charizard @ Heavy-Duty Boots
Ability: Blaze
- Flamethrower
- Air Slash`;

const sampleRecords: readonly PokemonRecord[] = [
  {
    species: "Pikachu",
    nickname: "Sparky",
    item: "Light Ball",
    ability: "Static",
    moves: ["Thunderbolt", "Volt Switch", "Grass Knot", "Protect"],
  },
  {
    species: "Charizard",
    nickname: null,
    item: "Heavy-Duty Boots",
    ability: "Blaze",
    moves: ["Flamethrower", "Air Slash"],
  },
];

const accept = async (text: string, expected: readonly PokemonRecord[]) => {
  const result = await Effect.runPromise(parseTeamText(text));

  assert.deepEqual(result, expected);
};

describe("accepted team text", () => {
  test("parses the exam sample, preserving Pokemon and move order", () =>
    accept(sample, sampleRecords));

  test("parses one Pokemon with LF endings, one move, and null optional fields", () =>
    accept(minimalTeam, [pikachu]));

  test("accepts six Pokemon blocks separated by blank lines", () =>
    accept(Array(6).fill(minimalTeam).join("\n\n"), Array(6).fill(pikachu)));

  test("accepts CRLF line endings", () =>
    accept(sample.replaceAll("\n", "\r\n"), sampleRecords));

  test("trims surrounding whitespace on each line", () =>
    accept(" \tPikachu \t\n \tAbility: Static \t\n \t- Thunderbolt \t", [
      pikachu,
    ]));

  test("accepts whitespace-only blank lines between Pokemon blocks", () =>
    accept(sample.replace("\n\n", "\n \t\n"), sampleRecords));

  const headings = [
    {
      name: "a held item without a nickname",
      heading: "Pikachu @ Light Ball",
      expected: { ...pikachu, item: "Light Ball" },
    },
    {
      name: "a nickname without a held item",
      heading: "Sparky (Pikachu)",
      expected: { ...pikachu, nickname: "Sparky" },
    },
    {
      name: "a nickname and held item",
      heading: "Sparky (Pikachu) @ Light Ball",
      expected: { ...pikachu, nickname: "Sparky", item: "Light Ball" },
    },
    {
      name: "a male gender marker without a nickname",
      heading: "Pikachu (M)",
      expected: pikachu,
    },
    {
      name: "a female gender marker without a nickname",
      heading: "Pikachu (F)",
      expected: pikachu,
    },
    {
      name: "a nickname and male gender marker",
      heading: "Sparky (Pikachu) (M)",
      expected: { ...pikachu, nickname: "Sparky" },
    },
    {
      name: "a nickname and female gender marker",
      heading: "Sparky (Pikachu) (F)",
      expected: { ...pikachu, nickname: "Sparky" },
    },
  ];

  headings.forEach(({ name, heading, expected }) => {
    test(`reads ${name}`, () =>
      accept(`${heading}\nAbility: Static\n- Thunderbolt`, [expected]));
  });

  const metadata = [
    "Level: 50",
    "Shiny: Yes",
    "Happiness: 255",
    "EVs: 252 SpA / 4 SpD / 252 Spe",
    "IVs: 0 Atk",
    "Tera Type: Electric",
    "Timid Nature",
  ];

  metadata.forEach((line) => {
    test(`allows metadata ${line} without adding record fields`, () =>
      accept(`${minimalTeam}\n${line}`, [pikachu]));
  });
});

describe("rejected team text", () => {
  const cases = [
    ["an empty team", ""],
    ["a whitespace-only team", " \t\n\r\n"],
    ["more than six Pokemon", Array(7).fill(minimalTeam).join("\n\n")],
    ["a missing species", " @ Light Ball\nAbility: Static\n- Thunderbolt"],
    [
      "duplicate ability lines",
      "Pikachu\nAbility: Static\nAbility: Static\n- Thunderbolt",
    ],
    ["a Pokemon with no moves", "Pikachu\nAbility: Static"],
    ["an empty move", "Pikachu\nAbility: Static\n-"],
    ["a whitespace-only move", "Pikachu\nAbility: Static\n- \t"],
    [
      "more than four moves",
      "Pikachu\nAbility: Static\n- Thunderbolt\n- Protect\n- Volt Switch\n- Grass Knot\n- Tackle",
    ],
    [
      "an unrecognized line",
      "Pikachu\nAbility: Static\nTrainer: Alex\n- Thunderbolt",
    ],
  ];

  cases.forEach(([name, text]) => {
    test(`rejects ${name} with a meaningful team-text error`, async () => {
      const error: unknown = await Effect.runPromise(
        Effect.flip(parseTeamText(text)),
      );

      assert.ok(error instanceof InvalidTeamText);
      assert.ok(error.message.trim().length > 0);
    });
  });
});

test("candidate-owned: rejects missing ability with a meaningful team-text error", async () => {
  const text = "Pikachu\nLevel: 50\n- Thunderbolt";
  const error: unknown = await Effect.runPromise(
    Effect.flip(parseTeamText(text)),
  );

  assert.ok(error instanceof InvalidTeamText);
  assert.ok(error.message.trim().length > 0);
});

test("candidate-owned: rejects empty ability with a meaningful team-text error", async () => {
  const text = "Pikachu\nAbility: \nLevel: 50\n- Thunderbolt";
  const error: unknown = await Effect.runPromise(
    Effect.flip(parseTeamText(text)),
  );

  assert.ok(error instanceof InvalidTeamText);
  assert.ok(error.message.trim().length > 0);
});
