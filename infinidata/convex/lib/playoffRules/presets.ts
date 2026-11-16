import { bracketRoundCount } from "./bracketMath";
import type { PlayoffFormat, PresetConfig, TeamSource, Tiebreaker } from "./format";

// The commissioner's rules form: each preset's settings (PresetConfig)
// build a complete PlayoffFormat, stored with the settings so the form can
// reopen them.

function seedingRules(seeding: "record" | "points", endWeek: number): Tiebreaker[] {
  const points: Tiebreaker = { kind: "pointsFor", fromWeek: 1, toWeek: endWeek };
  return seeding === "points" ? [points] : [{ kind: "winPct" }, points];
}

function consecutiveRounds(firstWeek: number, count: number, weeksPerRound = 1): number[][] {
  return Array.from({ length: count }, (_, round) =>
    Array.from({ length: weeksPerRound }, (_, w) => firstWeek + round * weeksPerRound + w),
  );
}

type StandardConfig = Extract<PresetConfig, { kind: "standard" }>;

export function defaultStandard(
  regularSeasonEndWeek: number,
  playoffTeams: number,
): StandardConfig {
  return {
    kind: "standard",
    regularSeasonEndWeek,
    playoffTeams,
    wildcards: 0,
    weeksPerRound: 1,
    reseed: false,
    toiletBowl: false,
    seeding: "record",
    seedBonus: {},
  };
}

// A single-elimination bracket of the top seeds (byes to the best), with
// optional points wildcards, reseeding, two-week rounds, per-seed bonuses,
// and a toilet bowl for everyone else.
export function standardFormat(config: StandardConfig, teamCount: number): PlayoffFormat {
  const end = config.regularSeasonEndWeek;
  const rounds = bracketRoundCount(config.playoffTeams);
  const firstWeek = end + 1;
  const bySeed = config.playoffTeams - config.wildcards;
  const entrants: TeamSource[] = [{ from: "seeds", firstSeed: 1, lastSeed: bySeed }];
  if (config.wildcards > 0) {
    entrants.push({
      from: "pointsLeaders",
      firstSeed: bySeed + 1,
      lastSeed: teamCount,
      count: config.wildcards,
      fromWeek: 1,
      toWeek: end,
    });
  }
  const bonus = Object.fromEntries(
    Object.entries(config.seedBonus).filter(([, perRound]) => perRound.some((b) => b !== 0)),
  );
  const format: PlayoffFormat = {
    preset: config,
    regularSeasonEndWeek: end,
    seeding: seedingRules(config.seeding, end),
    tiers: [],
    stages: [
      {
        kind: "bracket",
        id: "championship",
        name: "Championship",
        entrants,
        // Wildcards seed after every team that got in by seed.
        seeding: config.wildcards > 0 ? "sourceOrder" : "regularSeason",
        roundWeeks: consecutiveRounds(firstWeek, rounds, config.weeksPerRound),
        reseed: config.reseed,
        ...(Object.keys(bonus).length ? { bonus: { bySeedRound: bonus } } : {}),
      },
    ],
    championshipStageId: "championship",
  };
  const bowlTeams = teamCount - config.playoffTeams;
  if (config.toiletBowl && bowlTeams >= 2) {
    const bowlRounds = Math.min(bracketRoundCount(bowlTeams), rounds);
    format.stages.push({
      kind: "bracket",
      id: "toiletBowl",
      name: "Toilet Bowl",
      entrants: [{ from: "nonEntrants", stageId: "championship" }],
      seeding: "regularSeason",
      roundWeeks: consecutiveRounds(
        firstWeek + (rounds - bowlRounds) * config.weeksPerRound,
        bowlRounds,
        config.weeksPerRound,
      ),
      reseed: false,
      loserAdvances: true,
    });
  }
  return format;
}

// The platform's playoffs as a format - a standard bracket by record.
export function standardBracket(opts: {
  teamCount: number;
  regularSeasonEndWeek: number;
  playoffTeams: number;
}): PlayoffFormat {
  const format = standardFormat(
    defaultStandard(opts.regularSeasonEndWeek, opts.playoffTeams),
    opts.teamCount,
  );
  delete format.preset;
  return format;
}

type WorldCupConfig = Extract<PresetConfig, { kind: "worldCup" }>;

export const WORLD_CUP_TEAMS = 12;

export function defaultWorldCup(): WorldCupConfig {
  return { kind: "worldCup", regularSeasonEndWeek: 11, tierBonus: [15, 10, 5, 0] };
}

// Tiers by seed (S/A/B/C, three each), a matchup-draft group stage with
// tier bonuses - S teams draft weeks 1-3 of it, then pick a rematch for
// week 4 - and the group winners plus a points wildcard in a two-round
// knockout. Twelve teams.
export function worldCupFormat(config: WorldCupConfig = defaultWorldCup()): PlayoffFormat {
  const end = config.regularSeasonEndWeek;
  const [s, a, b, c] = config.tierBonus;
  const groupWeeks = [end + 1, end + 2, end + 3, end + 4];
  const pointsThroughGroups = { fromWeek: 1, toWeek: end + 4 };
  return {
    preset: config,
    regularSeasonEndWeek: end,
    seeding: seedingRules("record", end),
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
        entrants: [{ from: "seeds", firstSeed: 1, lastSeed: WORLD_CUP_TEAMS }],
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

export function presetFormat(config: PresetConfig, teamCount: number): PlayoffFormat {
  return config.kind === "standard" ? standardFormat(config, teamCount) : worldCupFormat(config);
}
