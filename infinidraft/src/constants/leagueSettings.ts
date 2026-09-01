import type {
  DraftTypeFormat,
  Position,
  ScoringFormat,
  TeScoringFormat,
} from "../types";
import type { KeeperRules } from "../lib/keeperCost";

export const ROSTER_SLOT_KEYS = [
  "QB",
  "SUPERFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
  "BENCH",
] as const;

export const SCORING_OPTIONS: Array<{ label: string; value: ScoringFormat }> = [
  { label: "No PPR", value: "STD" },
  { label: "Half PPR", value: "HALF" },
  { label: "PPR", value: "PPR" },
];

export const TE_SCORING_OPTIONS: Array<{
  label: string;
  value: TeScoringFormat;
}> = [
  { label: "No Bonus", value: "NONE" },
  { label: "+0.5 / Rec", value: "HALF" },
  { label: "+1 / Rec", value: "FULL" },
];

// SegmentedControl needs string values - "4"/"6" map to sixPointPassTds'
// underlying boolean at the call site rather than changing that field's
// type, since the schema/mutation payload still just wants a boolean.
export const PASSING_TD_OPTIONS: Array<{ label: string; value: "4" | "6" }> = [
  { label: "4pt Passing TD", value: "4" },
  { label: "6pt Passing TD", value: "6" },
];

export const DRAFT_TYPE_OPTIONS: Array<{
  label: string;
  value: DraftTypeFormat;
}> = [
  { label: "Auction", value: "auction" },
  { label: "Snake", value: "snake" },
  { label: "Linear", value: "linear" },
];

export interface LeagueSettingsFormValues {
  name: string;
  teamCount: number;
  // Only rides along with this form's own batched Save during creation -
  // an existing league's draftType instead changes via a live setDraftType
  // mutation (convex/leagues.ts, rejected once any picks/keepers exist),
  // same "live control, not batched with the rest of the form" shape
  // useKeepers below has. See SettingsForm.tsx's showDraftType/
  // draftTypeControl props.
  draftType: DraftTypeFormat;
  salaryCap: number;
  scoring: ScoringFormat;
  teScoring: TeScoringFormat;
  sixPointPassTds: boolean;
  rosterSlots: Record<(typeof ROSTER_SLOT_KEYS)[number], number>;
  flexPositions: Position[];
  superflexPositions: Position[];
  // Only meaningful during creation (see LeagueDetails.tsx's handleSave) -
  // an existing league's keepers setting is toggled live via the separate
  // setUseKeepers mutation instead, independent of this form's Save/Cancel.
  useKeepers: boolean;
}

export const DEFAULT_FORM: LeagueSettingsFormValues = {
  name: "Default $200/12-team",
  teamCount: 12,
  draftType: "auction",
  salaryCap: 200,
  scoring: "PPR",
  teScoring: "NONE",
  sixPointPassTds: false,
  rosterSlots: {
    QB: 1,
    SUPERFLEX: 0,
    RB: 2,
    WR: 2,
    FLEX: 1,
    TE: 1,
    DST: 1,
    K: 0,
    BENCH: 8,
  },
  flexPositions: ["RB", "WR", "TE"],
  superflexPositions: ["QB", "RB", "WR", "TE"],
  useKeepers: false,
};

export const DEFAULT_KEEPER_RULES: KeeperRules = {
  defaultFormula: { multiplier: 1, flatAdd: 0 },
  tiers: [],
};
