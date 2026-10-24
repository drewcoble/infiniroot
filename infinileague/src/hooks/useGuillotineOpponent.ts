import { useMemo } from "react";
import type { WeekGame } from "../lib/liveGames";
import { useEliminationWatch } from "./useEliminationWatch";

// A guillotine league has no head-to-head games, so its "opponent" is the
// team you have to outscore: the lowest live-projected of every other
// still-active team, re-picked as live scoring moves teams up and down
// (same ranking as Elimination Watch, lib/eliminationWatch.ts's rankLive).
// Ours on every platform rather than the provider's - Yahoo picks its own
// lowest-projected team off Yahoo's projections, Sleeper sends none.
//
// seasonId null = not a guillotine league (or not known yet), skipped.
// opponentId: undefined = still loading, null = no other active team.
// refreshMs re-fetches every lineup on that interval while games are live,
// same as useTeamRoster.
export function useGuillotineOpponent(
  seasonId: string | null,
  week: string | null,
  games: WeekGame[] | undefined,
  now: number,
  refreshMs: number | null = null,
) {
  const { rows, error } = useEliminationWatch(
    seasonId,
    week,
    games,
    now,
    refreshMs,
    "Failed to look up this week's lowest team.",
  );
  const opponentId = useMemo(() => {
    if (rows === undefined) return undefined;
    // Ranked best-to-worst, so the last one is the lowest.
    return rows.filter((row) => !row.isSelf).at(-1)?.teamId ?? null;
  }, [rows]);

  return {
    opponentId: error !== null ? null : opponentId,
    error,
  };
}
