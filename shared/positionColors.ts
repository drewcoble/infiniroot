// Plain inline union rather than importing infinidraft's own src/types.ts
// (a much bigger, draft-specific file) - this is the one piece of it that's
// genuinely generic across both apps. Exported so other shared modules
// (PositionFilterBar.tsx) can use the same type instead of redeclaring it.
export type Position = "QB" | "RB" | "WR" | "TE" | "DST" | "K";

// Single source of truth for position -> Mantine theme color, consumed by
// the position filter chips/badges (PlayersTable), budget progress bars
// (BudgetTab), and draft board player bars (PlayersLeftTab) - anywhere that
// used to fall back to Mantine's default primary color (blue) instead of
// reflecting the actual position.
export const POSITION_COLORS: Record<Position, string> = {
  QB: "qb",
  RB: "rb",
  WR: "wr",
  TE: "te",
  DST: "dst",
  K: "k",
};

// CSS-var form for consumers that set raw style properties (e.g.
// backgroundColor/outline) rather than passing a Mantine `color` prop.
export function positionColorVar(position: Position, shade: number): string {
  return `var(--mantine-color-${POSITION_COLORS[position]}-${shade})`;
}

const ADDITIONAL_POSITION_COLORS = {
  FLEX: "flex",
  SFLEX: "superflex",
  BENCH: "bn",
} as const;

export const POSITION_ORDER: string[] = [
  "QB",
  "SFLEX",
  "RB",
  "WR",
  "FLEX",
  "TE",
  "DST",
  "K",
  "BENCH",
];

// Same fallback, but for call sites keyed by a plain string that may or may
// not be one of the six Position values (e.g. a roster slot's group label,
// like "FLEX"/"SFLEX"/"BN" - see SlotDescriptor.label in lib/rosterSlots.ts -
// or the raw rosterSlots settings object's own field names, "FLEX"/
// "SUPERFLEX"/"BENCH" - see LeagueDetails.tsx). A league with more than one
// slot of a given kind numbers the labels ("RB1", "RB2", "FLEX1", "BN1",
// ...) - stripped here (rather than requiring every call site to remember
// to) so e.g. "RB1" still resolves to the RB color instead of falling
// through to the gray default. startsWith (on the stripped base) rather
// than an exact key lookup for FLEX/SFLEX/BENCH since those match by
// prefix, not full value, even before any digit is involved (e.g. the raw
// "SUPERFLEX" settings field name vs. slot label "SFLEX").
export function positionColorOrDefault(key: string): string {
  const base = key.replace(/\d+$/, "");
  if (base in POSITION_COLORS) return POSITION_COLORS[base as Position];
  if (base.startsWith("FLEX")) return ADDITIONAL_POSITION_COLORS.FLEX;
  if (base.startsWith("SFLEX") || base.startsWith("SUPERFLEX")) {
    return ADDITIONAL_POSITION_COLORS.SFLEX;
  }
  if (base.startsWith("BN") || base.startsWith("BENCH")) {
    return ADDITIONAL_POSITION_COLORS.BENCH;
  }
  return "gray";
}
