import type { MappedRosterSlots } from "../sleeper/leagueSettingsMapping";
import type { Scoring, TeScoring } from "../scoring";
import type { DraftType } from "../draftType";

// ESPN's league `settings` object (GET .../leagues/{id}?view=mSettings),
// trimmed to the fields mapped below. Every field here was confirmed live
// 2026-10-10 against a real public league (164483).
export interface EspnLeagueSettings {
  name: string;
  size: number;
  draftSettings?: { type?: string };
  acquisitionSettings?: {
    acquisitionBudget?: number;
    isUsingAcquisitionBudget?: boolean;
  };
  // Keyed by ESPN's numeric lineup slot id (stringified), value = how many
  // of that slot the league starts/rosters - see ESPN_SLOT_MAP below.
  rosterSettings?: { lineupSlotCounts?: Record<string, number> };
  scoringSettings?: {
    scoringItems?: Array<{
      statId: number;
      points: number;
      // Per-lineup-slot override of `points`, keyed by slot id (e.g. "6" =
      // TE) - how ESPN models TE premium (and D/ST-only scoring, "16").
      pointsOverrides?: Record<string, number>;
    }>;
  };
}

// ESPN's lineup slot ids. Only the ones this app has an equivalent for are
// mapped - narrower ESPN flexes (RB/WR, WR/TE) fold into FLEX the same
// simplified way Sleeper's WRRB_FLEX/REC_FLEX do (see
// convex/sleeper/leagueSettingsMapping.ts). 7 is ESPN's "OP" (offensive
// player), i.e. superflex.
export const ESPN_SLOT_MAP: Record<
  number,
  keyof MappedRosterSlots["rosterSlots"]
> = {
  0: "QB",
  2: "RB",
  3: "FLEX",
  4: "WR",
  5: "FLEX",
  6: "TE",
  7: "SUPERFLEX",
  16: "DST",
  17: "K",
  20: "BENCH",
  23: "FLEX",
};

export const ESPN_TE_SLOT_ID = 6;
export const ESPN_IR_SLOT_ID = 21;

// Labels for the slot ids with no equivalent here, so the wizard's
// "these slots were skipped" warning is readable. IR is left out on purpose -
// same as the Yahoo mapping, it doesn't cost a real roster spot.
const ESPN_DROPPED_SLOT_LABELS: Record<number, string> = {
  1: "TQB",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  18: "P",
  19: "HC",
};

export function mapEspnRosterSlots(
  lineupSlotCounts: Record<string, number> | undefined,
): MappedRosterSlots {
  const rosterSlots: MappedRosterSlots["rosterSlots"] = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    DST: 0,
    K: 0,
    FLEX: 0,
    SUPERFLEX: 0,
    BENCH: 0,
  };
  const droppedSlots = new Set<string>();

  for (const [slotIdKey, count] of Object.entries(lineupSlotCounts ?? {})) {
    const slotId = Number(slotIdKey);
    if (!count || count <= 0 || slotId === ESPN_IR_SLOT_ID) continue;
    const mapped = ESPN_SLOT_MAP[slotId];
    if (!mapped) {
      droppedSlots.add(ESPN_DROPPED_SLOT_LABELS[slotId] ?? `Slot ${slotId}`);
      continue;
    }
    rosterSlots[mapped] += count;
  }

  return {
    rosterSlots,
    flexPositions: rosterSlots.FLEX > 0 ? ["RB", "WR", "TE"] : [],
    superflexPositions:
      rosterSlots.SUPERFLEX > 0 ? ["QB", "RB", "WR", "TE"] : [],
    droppedSlots: [...droppedSlots],
  };
}

// ESPN's own stat ids for the two scoring signals this app models -
// same ids convex/espn/rankings.ts's ESPN_STAT_ID_TO_CATEGORY uses for
// projections ("53" = receptions, "4" = passing TDs).
const ESPN_REC_STAT_ID = 53;
const ESPN_PASS_TD_STAT_ID = 4;

function findScoringItem(
  settings: EspnLeagueSettings["scoringSettings"],
  statId: number,
) {
  return settings?.scoringItems?.find((item) => item.statId === statId);
}

// Same nearest-bucket thresholds as Sleeper's mapScoringSettings.
export function mapEspnScoring(
  settings: EspnLeagueSettings["scoringSettings"],
): Scoring {
  const rec = findScoringItem(settings, ESPN_REC_STAT_ID)?.points ?? 0;
  if (rec >= 0.75) return "PPR";
  if (rec >= 0.25) return "HALF";
  return "STD";
}

export function mapEspnSixPointPassTds(
  settings: EspnLeagueSettings["scoringSettings"],
): boolean {
  return (findScoringItem(settings, ESPN_PASS_TD_STAT_ID)?.points ?? 4) >= 5;
}

// ESPN expresses TE premium as a TE-slot override of the reception stat's
// whole per-catch value, not a separate bonus stat - the bonus is that
// override minus the league's base reception value.
export function mapEspnTeScoring(
  settings: EspnLeagueSettings["scoringSettings"],
): TeScoring {
  const item = findScoringItem(settings, ESPN_REC_STAT_ID);
  const teOverride = item?.pointsOverrides?.[String(ESPN_TE_SLOT_ID)];
  if (!item || teOverride === undefined) return "NONE";
  const bonus = teOverride - item.points;
  if (bonus >= 0.75) return "FULL";
  if (bonus >= 0.25) return "HALF";
  return "NONE";
}

// "AUCTION"/"SNAKE" confirmed live; anything else (offline/autopick
// variants) maps to undefined, and the wizard falls back to auction.
export function mapEspnDraftType(
  draftSettings: EspnLeagueSettings["draftSettings"],
): DraftType | undefined {
  switch (draftSettings?.type) {
    case "AUCTION":
      return "auction";
    case "SNAKE":
      return "snake";
    default:
      return undefined;
  }
}

export function mapEspnWaiverType(
  acquisitionSettings: EspnLeagueSettings["acquisitionSettings"],
): "faab" | "priority" {
  return acquisitionSettings?.isUsingAcquisitionBudget ? "faab" : "priority";
}
