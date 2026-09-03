export type SortDir = "asc" | "desc";

// Shared comparator for clickable-header player tables - undefined always
// sorts last regardless of direction (e.g. myValue/suggestedBid before a
// team is known), rather than jumping to the top on an ascending sort. Same
// as infinidraft's own src/lib/tableSort.ts - duplicated rather than
// imported, same app-boundary convention convex/lib/rosterSlots.ts's own
// duplicated helpers already follow.
export function compareSortValues(a: number | string | undefined, b: number | string | undefined, dir: SortDir): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const raw = typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : (a as number) - (b as number);
  return dir === "asc" ? raw : -raw;
}
