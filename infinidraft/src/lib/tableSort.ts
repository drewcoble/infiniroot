export type SortDir = "asc" | "desc";

// Shared comparator for clickable-header player tables (PlayersTable.tsx,
// PlayersLeftTab.tsx) - undefined always sorts last regardless of
// direction (e.g. "vs. market" for a deep-bench player the external source
// doesn't rank), rather than jumping to the top on an ascending sort.
export function compareSortValues(
  a: number | string | undefined,
  b: number | string | undefined,
  dir: SortDir,
): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const raw =
    typeof a === "string" && typeof b === "string"
      ? a.localeCompare(b)
      : (a as number) - (b as number);
  return dir === "asc" ? raw : -raw;
}
