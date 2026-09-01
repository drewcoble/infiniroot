export type Position = "QB" | "RB" | "WR" | "TE" | "DST" | "K";

export const POSITIONS: readonly Position[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "DST",
  "K",
];

export type ScoringFormat = "STD" | "HALF" | "PPR";

export type TeScoringFormat = "NONE" | "HALF" | "FULL";

// Mirrors convex/draftType.ts's DraftType - duplicated rather than imported,
// same convention as ScoringFormat/TeScoringFormat above (both plain literal
// unions kept in sync by hand rather than type-imported from convex/).
export type DraftTypeFormat = "auction" | "snake" | "linear";

export interface ScoringConfig {
  scoring: ScoringFormat;
  teScoring: TeScoringFormat;
  sixPointPassTds: boolean;
}

// The canonical shape of one row from draftValues.getDraftValues - shared by
// PlayersTable and the Draft Room instead of each declaring it inline.
export interface DraftValueRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  points: number;
  positionRank: number;
  replacementPoints: number;
  usedFallback: boolean;
  valueOverReplacement: number;
  dollarValue: number;
}

// One row from draft.board.getDraftBoard - draftValues.getDraftValues plus
// tier. Deliberately does NOT include live pick status: this query's read
// dependencies (draftSettings + projections) are stable for the duration of
// a draft, so it's not invalidated/recomputed on every pick the way a
// picks-joined version would be.
export interface DraftTierRow extends DraftValueRow {
  tier: number;
  tierLabel: string;
  // Blended ADP + points + $ value rank within the position - the order
  // getDraftBoard returns rows in, and what consumers should sort by to keep
  // tiers contiguous (see PlayersLeftTab.tsx's groupByTier).
  tierRank: number;
}

// DraftTierRow + live drafted status, joined client-side from a
// listDraftPicks subscription (see PlayersLeftTab) - cheap to recompute on
// every pick, unlike the VBD valuation in DraftTierRow.
export interface DraftBoardRow extends DraftTierRow {
  drafted: boolean;
  draftedByTeamId?: string;
  draftedPrice?: number;
}

// The canonical shape of one row from valueGaps.getAllValueGaps - a player
// whose track record and current-season outlook disagree with either their
// ADP ("undervalued"/"overvalued") or with each other ("breakout": bad last
// season but good this season by both projection and ADP; "falloff": the
// mirror image, good last season but bad this season on both). See
// convex/valueGaps.ts for the full methodology.
export interface ValueGap {
  fpid: number;
  position: Position;
  direction: "undervalued" | "overvalued" | "breakout" | "falloff";
  gap: number;
  lastYearPpg: number;
  lastYearGames: number;
  lastYearRank: number;
  projRank: number;
  adpRank: number;
  poolSize: number;
}

export type OverspendBehavior = "bench" | "spread" | "ask";

// Manual per-player "target"/"avoid" annotation, scoped to one draft. No
// row/no entry means no opinion.
export type PlayerTag = "target" | "avoid";
