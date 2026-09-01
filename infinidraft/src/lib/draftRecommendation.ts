import {
  MAX_PX_PER_DOLLAR,
  MIN_BAR_WIDTH,
  TARGET_MAX_BAR_WIDTH,
} from "../constants/playersLeft";
import type { DraftBoardRow } from "../types";
import type { ConsistencyLabel } from "./consistency";

export function recommendationFor(
  remainingTopTiers: number,
  openSlotsForPosition: number,
): { label: string; color: string } {
  if (openSlotsForPosition <= 0) return { label: "HOLD", color: "gray" };
  if (remainingTopTiers <= openSlotsForPosition) {
    return { label: "BID HARDER", color: "red" };
  }
  if (remainingTopTiers > openSlotsForPosition * 3) {
    return { label: "WAIT", color: "green" };
  }
  return { label: "HOLD", color: "gray" };
}

// Consecutive rows share a tier group since rows arrive sorted by tierRank
// (the blended ADP+points+$ value rank tiers are clustered from), which is
// monotonic with tier - no separate pass needed to bucket them.
export function groupByTier(rows: DraftBoardRow[]) {
  const groups: Array<{
    tier: number;
    tierLabel: string;
    rows: DraftBoardRow[];
  }> = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.tier === row.tier) {
      last.rows.push(row);
    } else {
      groups.push({ tier: row.tier, tierLabel: row.tierLabel, rows: [row] });
    }
  }
  return groups;
}

// Ratio of asking price to remaining budget beyond which opacity bottoms out
// at MIN_BUDGET_OPACITY rather than continuing to fade further. Tunable
// starting point, not empirically fit.
const BUDGET_OPACITY_FLOOR_RATIO = 1.25;
const MIN_BUDGET_OPACITY = 0.45;

// Affordability is conveyed by opacity alone (full opacity within budget,
// fading out the further over budget a player is) - it never changes fill
// color, which is reserved entirely for the consistency stoplight below.
function budgetOpacity(
  dollarValue: number,
  budgetAmount: number | undefined,
): number {
  if (budgetAmount === undefined || budgetAmount <= 0) return 1;
  const ratio = dollarValue / budgetAmount;
  if (ratio <= 1) return 1;
  const t = Math.min((ratio - 1) / (BUDGET_OPACITY_FLOOR_RATIO - 1), 1);
  return 1 - t * (1 - MIN_BUDGET_OPACITY);
}

// Consistency stoplight (green/yellow/red) shown as a thick, high-saturation
// outline - the -9 shade (vs. the fill's -6) plus the outline's own offset
// ring keep it legible even against a same-hued fill (e.g. a "target"
// player who is also Reliable/green).
function consistencyOutline(consistency: ConsistencyLabel | undefined): string {
  if (!consistency) return "none";
  // const color =
  //   consistency === "Reliable"
  //     ? "saddlebrown-4"
  //     : consistency === "Boom/Bust"
  //       ? "blue-9"
  //       : "red-8";
  // return `2.5px solid var(--mantine-color-${color})`;
  return `none`;
}

// The most expensive currently-undrafted player (across the whole board,
// not just whatever positions are toggled visible - see PlayersLeftTab.tsx's
// highestVisibleDollarValue) reaches TARGET_MAX_BAR_WIDTH; everyone else
// scales down from there at the same recalculated px/dollar rate, floored
// at MIN_BAR_WIDTH. Recalculating against the current board (rather than a
// fixed px/dollar rate tuned for early-draft prices) is what keeps a late-
// draft board of $1-$5 leftovers from all being squashed indistinguishably
// to MIN_BAR_WIDTH. MAX_PX_PER_DOLLAR caps how far that rate can climb when
// the board's priciest leftover is itself cheap, so a $1 player never
// balloons toward the same width as that "priciest" $3 one.
export function barWidth(
  dollarValue: number,
  highestVisibleDollarValue: number,
): number {
  const rate =
    highestVisibleDollarValue > 0
      ? Math.min(
          MAX_PX_PER_DOLLAR,
          TARGET_MAX_BAR_WIDTH / highestVisibleDollarValue,
        )
      : MAX_PX_PER_DOLLAR;
  return Math.max(MIN_BAR_WIDTH, Math.round(dollarValue * rate));
}

// Bar fill is just the target/avoid tag (green/red), defaulting to blue
// absent a tag - the consistency rating lives on the outline instead (see
// consistencyOutline above), so both signals stay visible at once.
export function barStyle(
  consistency: ConsistencyLabel | undefined,
  dollarValue: number,
  budgetAmount: number | undefined,
): { backgroundColor: string; opacity: number; outline: string } {
  // indigo-9 is a near-black navy - fine against the dark-mode body (and
  // whatever text sits on top), but it makes bars unreadable in light mode
  // (dark fill + default dark text = both dark). Light mode gets a
  // brighter indigo-5 instead so the default dark text stays legible on it.
  const backgroundColor =
    "light-dark(var(--mantine-color-indigo-5), var(--mantine-color-indigo-9))";

  const outline = consistencyOutline(consistency);
  const opacity = budgetOpacity(dollarValue, budgetAmount);

  return { backgroundColor, opacity, outline };
}
