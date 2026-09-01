import type { ScoringFormat } from "../types";

export type EspnFormat = "standard" | "ppr" | "superflex";

export interface StandardValueRow {
  fpid: number;
  rank: number;
  auctionValue: number;
}

export type StandardValuesByFormat = Record<EspnFormat, StandardValueRow[]>;

function toMap(rows: StandardValueRow[]): Map<number, StandardValueRow> {
  return new Map(rows.map((row) => [row.fpid, row]));
}

// Averages two formats' rows per-player - only where both have that player;
// falls back to whichever one does otherwise. Used for HALF-scoring leagues
// below, the one case that needs more than a single ESPN format.
function averageStandardValues(
  a: Map<number, StandardValueRow>,
  b: Map<number, StandardValueRow>,
): Map<number, StandardValueRow> {
  const map = new Map<number, StandardValueRow>();
  for (const fpid of new Set([...a.keys(), ...b.keys()])) {
    const rowA = a.get(fpid);
    const rowB = b.get(fpid);
    if (rowA && rowB) {
      map.set(fpid, {
        fpid,
        rank: (rowA.rank + rowB.rank) / 2,
        auctionValue: (rowA.auctionValue + rowB.auctionValue) / 2,
      });
    } else {
      map.set(fpid, (rowA ?? rowB)!);
    }
  }
  return map;
}

// Builds the fpid -> {rank, auctionValue} map a league should actually
// compare its own values against. ESPN has no half-PPR format (see convex/
// espn/rankings.ts), so a HALF-scoring league averages standard+ppr instead
// of picking one. A superflex league (any real SUPERFLEX roster slot, not
// just QB being flex-eligible) uses ESPN's own superflex format regardless
// of PPR/STD/HALF, since that's the one format ESPN itself treats as a
// distinct player pool/valuation rather than a scoring-rule variant.
export function buildStandardValueByFpid(
  standardValues: StandardValuesByFormat | undefined,
  scoring: ScoringFormat,
  isSuperflex: boolean,
): Map<number, StandardValueRow> {
  if (!standardValues) return new Map();

  if (isSuperflex) return toMap(standardValues.superflex);
  if (scoring === "STD") return toMap(standardValues.standard);
  if (scoring === "PPR") return toMap(standardValues.ppr);
  return averageStandardValues(
    toMap(standardValues.standard),
    toMap(standardValues.ppr),
  );
}
