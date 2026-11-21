import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Position } from "@shared/positionColors";
import type { LinkedSeason } from "@shared/league/types/season";

export const ALL_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "DST", "K"];

// The positions this league can actually start - a dedicated roster slot or
// FLEX/SUPERFLEX eligibility, same rule as shared/InjuryReport.tsx - so a
// no-kicker league never shows a K filter or kickers. Every position while
// the league is still loading, so nothing flashes empty.
export function useLeaguePositions(seasonId: string): readonly Position[] {
  const { isAuthenticated } = useConvexAuth();
  const seasons: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );
  const season = seasons?.find((s) => s._id === seasonId);
  return useMemo(() => {
    if (!season) return ALL_POSITIONS;
    return ALL_POSITIONS.filter(
      (pos) =>
        season.rosterSlots[pos] > 0 ||
        season.flexPositions.includes(pos) ||
        season.superflexPositions.includes(pos),
    );
  }, [season]);
}
