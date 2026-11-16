// infiniyoffs' playoff format: the regular season's seeding and tiers, then
// a chain of stages (groups, brackets, points races) that each draw their
// teams from the seeds or from earlier stages. Plain data - stored on the
// season's playoffFormats row and evaluated by ./evaluate.ts, on the server
// (current state, odds) and in the browser (what-ifs) alike.

// Ranking rules, applied in order until two teams differ.
export type Tiebreaker =
  | { kind: "winPct" }
  // Raw points scored over these weeks (inclusive) - never seed bonuses.
  | { kind: "pointsFor"; fromWeek: number; toWeek: number }
  | { kind: "pointsAgainst"; fromWeek: number; toWeek: number }
  // Head-to-head record among the tied teams.
  | { kind: "headToHead" }
  // Regular-season seed (lower is better) - the last resort.
  | { kind: "seed" };

export interface Tier {
  name: string;
  // Regular-season seeds, inclusive.
  firstSeed: number;
  lastSeed: number;
}

// Where a stage's teams come from.
export type TeamSource =
  | { from: "seeds"; firstSeed: number; lastSeed: number }
  // The teams that advance out of an earlier stage (group winners, a
  // bracket's champion).
  | { from: "advancers"; stageId: string }
  // Everyone an earlier stage started with but didn't advance.
  | { from: "eliminated"; stageId: string }
  // Every team that isn't one of an earlier stage's entrants (a toilet
  // bowl of everyone who missed the playoffs).
  | { from: "nonEntrants"; stageId: string }
  // The best `count` teams by raw points over these weeks, from these
  // regular-season seeds - wildcards straight from the regular season.
  | {
      from: "pointsLeaders";
      firstSeed: number;
      lastSeed: number;
      count: number;
      fromWeek: number;
      toWeek: number;
    }
  // The best `count` teams by raw points over these weeks, out of every
  // team the listed stages eliminated.
  | {
      from: "wildcards";
      stageIds: string[];
      count: number;
      fromWeek: number;
      toWeek: number;
    };

// Points added to a team's score in a stage's games - by tier (every week
// of the stage), or by seed and round (a bracket's per-round head starts).
export interface Bonus {
  byTier?: Record<string, number>;
  // Seed (1-based, within this stage) -> bonus per round, round 1 first.
  bySeedRound?: Record<number, number[]>;
}

// Groups formed by a matchup draft: the drafter tier's teams pick a draft
// slot, then snake-draft (opponent, week) pairs over draftWeeks - each pick
// puts the opponent in the drafter's group and fixes the group's round
// robin. Then, in each rematch week, every drafter picks a group-mate to
// play again (the other two group-mates play each other).
export interface MatchupDraftFormation {
  kind: "matchupDraft";
  drafterTier: string;
  draftWeeks: number[];
  rematchWeeks: number[];
  snake: boolean;
}

// Groups dealt out by seed in serpentine order (1-2-3-3-2-1-...), each
// playing a round robin over `weeks`.
export interface SerpentineFormation {
  kind: "serpentine";
}

export interface GroupStage {
  kind: "groups";
  id: string;
  name: string;
  entrants: TeamSource[];
  groupCount: number;
  formation: MatchupDraftFormation | SerpentineFormation;
  // Every week the groups play, draft and rematch weeks included.
  weeks: number[];
  bonus?: Bonus;
  ranking: Tiebreaker[];
  // Top this many from each group advance.
  advancePerGroup: number;
}

export interface BracketStage {
  kind: "bracket";
  id: string;
  name: string;
  entrants: TeamSource[];
  // "regularSeason": all entrants seeded by regular-season seed.
  // "sourceOrder": each source in turn, regular-season seed within it - so
  // group winners outrank a wildcard regardless of seed.
  seeding: "regularSeason" | "sourceOrder";
  // Weeks per round, round 1 first. A multi-week round sums its weeks.
  roundWeeks: number[][];
  reseed: boolean;
  bonus?: Bonus;
  // A toilet bowl: the loser of each game moves on.
  loserAdvances?: boolean;
}

// No head-to-head: the top `advance` teams by points over `weeks` move on.
export interface PointsStage {
  kind: "points";
  id: string;
  name: string;
  entrants: TeamSource[];
  weeks: number[];
  bonus?: Bonus;
  advance: number;
}

export type Stage = GroupStage | BracketStage | PointsStage;

// The rules form's settings a format was built from (see presets.ts), so
// the commissioner can reopen and adjust them. Absent = built by hand.
export type PresetConfig =
  | {
      kind: "standard";
      regularSeasonEndWeek: number;
      playoffTeams: number;
      // Of playoffTeams, how many get in on points instead of seed.
      wildcards: number;
      weeksPerRound: 1 | 2;
      reseed: boolean;
      toiletBowl: boolean;
      seeding: "record" | "points";
      // Seed -> bonus per round, round 1 first.
      seedBonus: Record<number, number[]>;
    }
  | {
      kind: "worldCup";
      regularSeasonEndWeek: number;
      tierBonus: [number, number, number, number];
    };

export interface PlayoffFormat {
  preset?: PresetConfig;
  regularSeasonEndWeek: number;
  seeding: Tiebreaker[];
  tiers: Tier[];
  stages: Stage[];
  // The stage whose advancer is the league champion.
  championshipStageId: string;
}

// The matchup draft's recorded choices - the playoffDrafts row, minus ids.
export interface DraftState {
  // Each drafter's chosen draft slot (1-based), chosen in seed order.
  slots: { drafterId: string; slot: number }[];
  picks: { drafterId: string; opponentId: string; week: number }[];
  rematches: { drafterId: string; opponentId: string; week: number }[];
}

export const EMPTY_DRAFT: DraftState = { slots: [], picks: [], rematches: [] };
