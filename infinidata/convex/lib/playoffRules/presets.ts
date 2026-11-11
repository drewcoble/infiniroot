import { bracketRoundCount } from "./bracketMath";
import type { PlayoffFormat, Tiebreaker } from "./format";

// Starting points for the commissioner's rules form - each one a complete
// PlayoffFormat the form then adjusts.

const standardSeeding = (endWeek: number): Tiebreaker[] => [
  { kind: "winPct" },
  { kind: "pointsFor", fromWeek: 1, toWeek: endWeek },
];

function consecutiveRounds(firstWeek: number, count: number, weeksPerRound = 1): number[][] {
  return Array.from({ length: count }, (_, round) =>
    Array.from({ length: weeksPerRound }, (_, w) => firstWeek + round * weeksPerRound + w),
  );
}

// A single-elimination bracket of the top `playoffTeams` (byes to the top
// seeds), plus an optional toilet bowl for everyone else.
export function standardBracket(opts: {
  teamCount: number;
  regularSeasonEndWeek: number;
  playoffTeams: number;
  reseed?: boolean;
  toiletBowl?: boolean;
}): PlayoffFormat {
  const rounds = bracketRoundCount(opts.playoffTeams);
  const firstWeek = opts.regularSeasonEndWeek + 1;
  const format: PlayoffFormat = {
    regularSeasonEndWeek: opts.regularSeasonEndWeek,
    seeding: standardSeeding(opts.regularSeasonEndWeek),
    tiers: [],
    stages: [
      {
        kind: "bracket",
        id: "championship",
        name: "Championship",
        entrants: [{ from: "seeds", firstSeed: 1, lastSeed: opts.playoffTeams }],
        seeding: "regularSeason",
        roundWeeks: consecutiveRounds(firstWeek, rounds),
        reseed: opts.reseed ?? false,
      },
    ],
    championshipStageId: "championship",
  };
  const bowlTeams = opts.teamCount - opts.playoffTeams;
  if (opts.toiletBowl && bowlTeams >= 2) {
    const bowlRounds = Math.min(bracketRoundCount(bowlTeams), rounds);
    format.stages.push({
      kind: "bracket",
      id: "toiletBowl",
      name: "Toilet Bowl",
      entrants: [{ from: "seeds", firstSeed: opts.playoffTeams + 1, lastSeed: opts.teamCount }],
      seeding: "regularSeason",
      roundWeeks: consecutiveRounds(firstWeek + rounds - bowlRounds, bowlRounds),
      reseed: false,
      loserAdvances: true,
    });
  }
  return format;
}

// Tiers by seed, a matchup-draft group stage with tier bonuses, then the
// group winners plus a points wildcard in a knockout. Defaults are the
// 12-team original: S/A/B/C tiers of three, drafts over weeks 12-14, a
// week-15 rematch, semis in 16 and the final in 17.
export function worldCup(
  opts: {
    regularSeasonEndWeek?: number;
    tierBonus?: [number, number, number, number];
  } = {},
): PlayoffFormat {
  const end = opts.regularSeasonEndWeek ?? 11;
  const [s, a, b, c] = opts.tierBonus ?? [15, 10, 5, 0];
  const groupWeeks = [end + 1, end + 2, end + 3, end + 4];
  const pointsThroughGroups = { fromWeek: 1, toWeek: end + 4 };
  return {
    regularSeasonEndWeek: end,
    seeding: standardSeeding(end),
    tiers: [
      { name: "S", firstSeed: 1, lastSeed: 3 },
      { name: "A", firstSeed: 4, lastSeed: 6 },
      { name: "B", firstSeed: 7, lastSeed: 9 },
      { name: "C", firstSeed: 10, lastSeed: 12 },
    ],
    stages: [
      {
        kind: "groups",
        id: "groups",
        name: "Group Stage",
        entrants: [{ from: "seeds", firstSeed: 1, lastSeed: 12 }],
        groupCount: 3,
        formation: {
          kind: "matchupDraft",
          drafterTier: "S",
          draftWeeks: groupWeeks.slice(0, 3),
          rematchWeeks: groupWeeks.slice(3),
          snake: true,
        },
        weeks: groupWeeks,
        bonus: { byTier: { S: s, A: a, B: b, C: c } },
        ranking: [{ kind: "winPct" }, { kind: "pointsFor", ...pointsThroughGroups }],
        advancePerGroup: 1,
      },
      {
        kind: "bracket",
        id: "knockout",
        name: "Knockout",
        entrants: [
          { from: "advancers", stageId: "groups" },
          { from: "wildcards", stageIds: ["groups"], count: 1, ...pointsThroughGroups },
        ],
        seeding: "sourceOrder",
        roundWeeks: [[end + 5], [end + 6]],
        reseed: false,
      },
    ],
    championshipStageId: "knockout",
  };
}
