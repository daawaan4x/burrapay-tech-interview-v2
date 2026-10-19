import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as Effect from "effect/Effect";
import { InvalidMatchText } from "../src/domain.ts";
import { parseMatchText } from "../src/match-parser.ts";

export const seasonTeams = {
  TMA: "Team A",
  TMB: "Team B",
} as const;

export const mdSample = `
TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)
`.trim();

const firstPlainLink = "Player A: https://www.vrpastes.com/tgiS1Swl";
const sample = `TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: https://www.vrpastes.com/tgiS1Swl
Player B: https://www.vrpastes.com/VvVArqgO`;

const sampleParsed = {
  participants: [
    {
      teamCode: "TMA",
      playerName: "Player A",
      score: 2,
      pasteUrl: "https://www.vrpastes.com/tgiS1Swl",
    },
    {
      teamCode: "TMB",
      playerName: "Player B",
      score: 0,
      pasteUrl: "https://www.vrpastes.com/VvVArqgO",
    },
  ],
  winner: "TMA",
};

const accept = async (text: string, expected = sampleParsed) => {
  const result = await Effect.runPromise(parseMatchText(text, seasonTeams));
  assert.deepEqual(result, expected);
};

const reject = async (text: string) => {
  // flip exposes expected failures; defects still reject and fail the test.
  const error = await Effect.runPromise(
    Effect.flip(parseMatchText(text, seasonTeams)),
  );
  assert.ok(error instanceof InvalidMatchText);
  assert.ok(
    error.message.trim().length > 0,
    "Expected a meaningful error message",
  );
};

describe("parseMatchText", () => {
  describe("accepted text", () => {
    const cases = [
      ["the exam sample with Markdown links", mdSample],
      ["plain links", sample],
      ["CRLF line endings", sample.replaceAll("\n", "\r\n")],
      ["additional blank lines", `\n\n${sample.replaceAll("\n", "\n\n")}\n\n`],
      ["whitespace-only blank lines", sample.replace("\n\n", "\n   \n\t\n")],
      [
        "leading and trailing whitespace on each line",
        sample
          .split("\n")
          .map((line) => ` \t${line}\t `)
          .join("\n"),
      ],
      [
        "multiple spaces around team vs",
        sample.replace("TMA vs TMB", "TMA   vs   TMB"),
      ],
      [
        "multiple spaces around player vs",
        sample.replace("Player A vs Player B", "Player A   vs   Player B"),
      ],
      [
        "whitespace around the score hyphen",
        sample.replace("Score: 2-0", "Score:   2  -  0"),
      ],
      [
        "multiple spaces after the URL colon",
        sample.replace(
          firstPlainLink,
          "Player A:   https://www.vrpastes.com/tgiS1Swl",
        ),
      ],
    ] as const;

    cases.forEach(([name, text]) => {
      test(`accepts ${name}`, () => accept(text));
    });
  });

  describe("scores and winners", () => {
    const cases = [
      ["2-1", 2, 1, "TMA"],
      ["0-2", 0, 2, "TMB"],
      ["1-2", 1, 2, "TMB"],
    ] as const;

    cases.forEach(([score, firstScore, secondScore, winner]) => {
      test(`accepts ${score} with winner ${winner}`, () =>
        accept(sample.replace("Score: 2-0", `Score: ${score}`), {
          participants: [
            { ...sampleParsed.participants[0], score: firstScore },
            { ...sampleParsed.participants[1], score: secondScore },
          ],
          winner,
        }));
    });
  });

  describe("invalid text", () => {
    const cases = [
      ["an extra nonblank line", `${sample}\nAdditional notes`],
      [
        "a missing player URL line",
        sample.replace("Player B: https://www.vrpastes.com/VvVArqgO", ""),
      ],
      ["a missing team code", sample.replace("TMA vs TMB", "TMA vs ")],
      [
        "an uppercase team separator",
        sample.replace("TMA vs TMB", "TMA VS TMB"),
      ],
      [
        "a missing player name",
        sample.replace("Player A vs Player B", "Player A vs "),
      ],
      [
        "an uppercase player separator",
        sample.replace("Player A vs Player B", "Player A VS Player B"),
      ],
      ["a missing URL", sample.replace(firstPlainLink, "Player A: ")],
      ["an unknown team code", sample.replace("TMA vs TMB", "TMA vs TMC")],
      ["a repeated team code", sample.replace("TMA vs TMB", "TMA vs TMA")],
      [
        "a team code with different casing",
        sample.replace("TMA vs TMB", "tma vs TMB"),
      ],
      ["a repeated player name", sample.replaceAll("Player B", "Player A")],
      [
        "a duplicate player URL line",
        sample.replace(
          "Player B: https://www.vrpastes.com/VvVArqgO",
          firstPlainLink,
        ),
      ],
      [
        "an unknown player on a URL line",
        sample.replace(
          firstPlainLink,
          "Player C: https://www.vrpastes.com/tgiS1Swl",
        ),
      ],
      [
        "a Markdown label that differs from its target",
        sample.replace(
          firstPlainLink,
          "Player A: [https://www.vrpastes.com/Other123](https://www.vrpastes.com/tgiS1Swl)",
        ),
      ],
    ] as const;

    cases.forEach(([name, text]) => {
      test(`rejects ${name}`, () => reject(text));
    });
  });

  describe("paste URLs", () => {
    const accepted = [
      ["an alphanumeric paste ID", "https://www.vrpastes.com/AbC123"],
      ["a single-character paste ID", "https://www.vrpastes.com/A"],
    ] as const;

    accepted.forEach(([name, url]) => {
      test(`accepts ${name}`, () =>
        accept(sample.replace(firstPlainLink, `Player A: ${url}`), {
          ...sampleParsed,
          participants: [
            { ...sampleParsed.participants[0], pasteUrl: url },
            sampleParsed.participants[1],
          ],
        }));
    });

    const rejected = [
      ["HTTP", "http://www.vrpastes.com/tgiS1Swl"],
      ["a hostname without www", "https://vrpastes.com/tgiS1Swl"],
      ["a hostname suffix", "https://www.vrpastes.com.example.org/tgiS1Swl"],
      ["credentials", "https://user:pass@www.vrpastes.com/tgiS1Swl"],
      ["an explicit port", "https://www.vrpastes.com:443/tgiS1Swl"],
      ["a query", "https://www.vrpastes.com/tgiS1Swl?view=raw"],
      ["a fragment", "https://www.vrpastes.com/tgiS1Swl#team"],
      ["an empty paste ID", "https://www.vrpastes.com/"],
      ["an extra path segment", "https://www.vrpastes.com/tgiS1Swl/extra"],
      ["a trailing slash", "https://www.vrpastes.com/tgiS1Swl/"],
      ["a non-alphanumeric paste ID", "https://www.vrpastes.com/paste-id"],
    ] as const;

    rejected.forEach(([name, url]) => {
      test(`rejects ${name}`, () =>
        reject(sample.replace(firstPlainLink, `Player A: ${url}`)));
    });
  });
});

describe("candidate-owned critical tests", () => {
  test("preserves correct pairing when participant input order is reversed", async () => {
    await accept(
      `
TMB vs TMA
Player B vs Player A
Score: 0-2

Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)
Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
`.trim(),
      {
        participants: [
          {
            teamCode: "TMB",
            playerName: "Player B",
            score: 0,
            pasteUrl: "https://www.vrpastes.com/VvVArqgO",
          },
          {
            teamCode: "TMA",
            playerName: "Player A",
            score: 2,
            pasteUrl: "https://www.vrpastes.com/tgiS1Swl",
          },
        ],
        winner: "TMA",
      },
    );
  });

  test("rejects invalid scores", async () => {
    // Valid scores are already tested in the winner results test section.
    // This section tests a few invalid scores, following the best of three rule.
    await reject(sample.replace("Score: 2-0", "Score: -1-1"));
    await reject(sample.replace("Score: 2-0", "Score: 3-0"));
    await reject(sample.replace("Score: 2-0", "Score: 0-3"));
    await reject(sample.replace("Score: 2-0", "Score: 4-4"));
    await reject(sample.replace("Score: 2-0", "Score: 0-10"));
    await reject(sample.replace("Score: 2-0", "Score: 10-0"));
  });
});
