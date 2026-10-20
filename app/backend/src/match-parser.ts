import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import {
  InvalidMatchText,
  type MatchParticipants,
  type Season,
} from "./domain.ts";

const invalid = (message: string) => new InvalidMatchText({ message });

const parseLines = (text: string) =>
  pipe(
    Effect.succeed(
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
    Effect.filterOrFail(
      (lines) => lines.length === 5,
      (lines) => invalid(`Expected 5 lines, found ${lines.length}`),
    ),
  );

const VS_PATTERN = / +vs +/;
const parseVs = (text: string) =>
  pipe(
    Effect.sync(() => text.split(VS_PATTERN)),
    Effect.filterOrFail(
      (parts) => parts.length === 2,
      () => invalid('Expected vs format: "[A] vs [B]"'),
    ),
  );

const parseTeamCodes = (text: string, teams: Season["teams"]) =>
  pipe(
    parseVs(text),
    Effect.filterOrFail(
      (codes) => codes.every((code) => Object.hasOwn(teams, code)),
      (codes) =>
        invalid(
          `Unknown team codes: ${codes.filter((code) => !Object.hasOwn(teams, code))}`,
        ),
    ),
    Effect.filterOrFail(
      ([a, b]) => a !== b,
      () => invalid("Expected team codes to be different"),
    ),
  );

const parsePlayer = (text: string) =>
  pipe(
    parseVs(text),
    Effect.filterOrFail(
      ([a, b]) => a !== b,
      () => invalid("Expected player names to be different"),
    ),
  );

const SCORE_PATTERN = /^Score: +(\d+) *- *(\d+)$/;
const POSSIBLE_SCORES = ["2-0", "2-1", "1-2", "0-2"];
const parseScore = (text: string) =>
  pipe(
    Effect.fromNullable(SCORE_PATTERN.exec(text)),
    Effect.mapError(() => invalid('Expected score format: "Score: [A]-[B]"')),
    Effect.filterOrFail(
      ([, a, b]) => POSSIBLE_SCORES.includes(`${a}-${b}`),
      () => invalid(`Invalid score, must be one of: ${POSSIBLE_SCORES}`),
    ),
    Effect.map(([, a, b]) => [Number(a), Number(b)]),
  );

const MDLINK_PATTERN = /^\[([^\]]*)\]\(([^)]*)\)$/;
const parseMdLink = (text: string) =>
  pipe(
    Effect.succeed(MDLINK_PATTERN.exec(text)),
    Effect.flatMap((result) => {
      if (!result) return Effect.succeed(text);
      if (result[1] === result[2]) return Effect.succeed(result[2]);
      return invalid("Expected markdown link label to match URL");
    }),
  );

const PASTE_URL_PATTERN = /^https:\/\/www\.vrpastes\.com\/[a-zA-Z0-9]+$/;
const parsePlayerLink = (text: string, playerName: string) =>
  pipe(
    Effect.succeed(text),
    Effect.map((text) => {
      const [first, ...rest] = text.split(`${playerName}:`);
      return [first, rest.join().trim()];
    }),
    Effect.filterOrFail(
      ([a, b]) => a === "" && b.length > 0,
      () => invalid('Expected paste-url format: "[Name]: <URL>"'),
    ),
    Effect.map(([, b]) => b),
    Effect.flatMap(parseMdLink),
    Effect.filterOrFail(
      (url) => PASTE_URL_PATTERN.test(url),
      () =>
        invalid("Expected link format: https://www.vrpastes.com/<alphanum-id>"),
    ),
  );

export const parseMatchText = (text: string, teams: Season["teams"]) =>
  pipe(
    Effect.Do,
    Effect.bind("lines", () => parseLines(text)),
    Effect.filterOrFail(
      ({ lines }) => lines[3] !== lines[4],
      () => invalid("Expected different player lines"),
    ),

    Effect.bind("teamCodes", ({ lines }) => parseTeamCodes(lines[0], teams)),
    Effect.bind("playerNames", ({ lines }) => parsePlayer(lines[1])),
    Effect.bind("scores", ({ lines }) => parseScore(lines[2])),
    Effect.bind("pasteUrls", ({ lines, playerNames }) =>
      pipe(
        Effect.all([
          parsePlayerLink(lines[3], playerNames[0]),
          parsePlayerLink(lines[4], playerNames[1]),
        ]),
      ),
    ),
    Effect.map(({ teamCodes, playerNames, scores, pasteUrls }) => ({
      participants: [
        {
          teamCode: teamCodes[0],
          playerName: playerNames[0],
          score: scores[0],
          pasteUrl: pasteUrls[0],
        },
        {
          teamCode: teamCodes[1],
          playerName: playerNames[1],
          score: scores[1],
          pasteUrl: pasteUrls[1],
        },
      ] satisfies MatchParticipants,
      winner: scores[0] > scores[1] ? teamCodes[0] : teamCodes[1],
    })),
  );

export const serializeMatch = ([a, b]: MatchParticipants) =>
  Effect.succeed(() =>
    `
${a.teamCode} vs ${b.teamCode}
${a.playerName} vs ${b.playerName}
Score: ${a.score}-${b.score}

${a.playerName}: ${a.pasteUrl}
${b.playerName}: ${b.pasteUrl}
`.trim(),
  );
