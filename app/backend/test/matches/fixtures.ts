import type { Match } from "../../src/domain.ts";

// Synthetic stored records for persistence/HTTP tests only. These are not raw
// parser inputs or oracles for the candidate's designated manual tests.
export const makeMatchRecord = (): Match => ({
  matchId: "05b69234-60e2-42e5-91aa-096bcae239d0",
  uploadId: "05b69234-60e2-42e5-91aa-096bcae239d0",
  seasonNumber: 1,
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
  winnerTeamCode: "TMA",
  parsedAt: "2026-10-14T00:00:00.000Z",
  importedTeams: null,
});

export const makeImportedMatchRecord = (): Match => ({
  ...makeMatchRecord(),
  importedTeams: {
    importedAt: "2026-10-14T00:05:00.000Z",
    participants: [
      {
        teamCode: "TMA",
        playerName: "Player A",
        sourceUrl: "https://www.vrpastes.com/tgiS1Swl",
        rawText: "Pikachu\nAbility: Static\n- Thunderbolt",
        pokemon: [
          {
            species: "Pikachu",
            nickname: null,
            item: null,
            ability: "Static",
            moves: ["Thunderbolt"],
          },
        ],
      },
      {
        teamCode: "TMB",
        playerName: "Player B",
        sourceUrl: "https://www.vrpastes.com/VvVArqgO",
        rawText: "Charizard\nAbility: Blaze\n- Flamethrower",
        pokemon: [
          {
            species: "Charizard",
            nickname: null,
            item: null,
            ability: "Blaze",
            moves: ["Flamethrower"],
          },
        ],
      },
    ],
  },
});
