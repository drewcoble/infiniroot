import type { OverspendBehavior } from "../types";
import { POSITION_COLORS } from "@shared/positionColors";

// Auto-adjustment runs both directions, not just overspends - going under
// plan on a pick frees up money the same way going over eats into it (see
// convex/draft/budgetAutoAdjust.ts). "ask" keeps its historical value (no
// schema/data migration needed for leagues that already had it saved) but
// is relabeled "Handle manually" - it was never wired up to an actual
// prompt, so calling it that overpromised; it's really just the explicit
// opt-out.
export const OVERSPEND_OPTIONS: Array<{
  value: OverspendBehavior;
  label: string;
  caption: string;
}> = [
  {
    value: "bench",
    label: "Auto-adjust: bench pool first",
    caption:
      "Going over or under plan on a pick adjusts the bench pool first, only reaching into starters if the bench runs out.",
  },
  {
    value: "spread",
    label: "Auto-adjust: spread across open slots",
    caption:
      "Going over or under plan on a pick is spread evenly across every slot still open.",
  },
  {
    value: "ask",
    label: "Handle manually",
    caption: "Nothing adjusts automatically - review and rebalance the numbers yourself.",
  },
];

// Category order for the top summary bar - matches POSITION_ORDER in
// lib/positionColors.ts.
export const CATEGORY_ORDER = [
  "QB",
  "SFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
  "BENCH",
] as const;

export const CATEGORY_LABELS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  QB: "QB",
  SFLEX: "SFLEX",
  RB: "RB",
  WR: "WR",
  FLEX: "FLEX",
  TE: "TE",
  DST: "DST",
  K: "K",
  BENCH: "bench",
};

export const CATEGORY_COLORS: Record<(typeof CATEGORY_ORDER)[number], string> = {
  QB: POSITION_COLORS.QB,
  SFLEX: "superflex",
  RB: POSITION_COLORS.RB,
  WR: POSITION_COLORS.WR,
  FLEX: "flex",
  TE: POSITION_COLORS.TE,
  DST: POSITION_COLORS.DST,
  K: POSITION_COLORS.K,
  BENCH: "bn",
};
