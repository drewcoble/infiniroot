import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { rankLive } from "../lib/eliminationWatch";
import type { WeekGame } from "../lib/liveGames";
import type { EliminationWatchRow } from "../types/season";

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
  const getEliminationWatch = useAction(
    api.infinileague.season.eliminationWatch.getEliminationWatch,
  );
  // Tagged with the season/week it was fetched for, same as useTeamRoster.
  const key = seasonId !== null && week !== null ? `${seasonId}:${week}` : null;
  const [result, setResult] = useState<{
    key: string;
    rows?: EliminationWatchRow[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (seasonId === null || week === null || key === null) return;
    let cancelled = false;
    const load = (initial: boolean) =>
      getEliminationWatch({ seasonId: seasonId as Id<"seasons">, week })
        .then((rows) => {
          if (!cancelled) setResult({ key, rows });
        })
        .catch((err) => {
          // A failed refresh keeps the last rows rather than an error.
          if (!cancelled && initial) {
            setResult({
              key,
              error: getErrorMessage(err, "Failed to look up this week's lowest team."),
            });
          }
        });
    void load(true);
    const id = refreshMs !== null ? setInterval(() => void load(false), refreshMs) : undefined;
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [seasonId, week, key, refreshMs, getEliminationWatch]);

  const current = result !== null && result.key === key ? result : null;
  const rows = current?.rows;
  const opponentId = useMemo(() => {
    if (rows === undefined) return undefined;
    // Ranked best-to-worst, so the last one is the lowest.
    return rankLive(rows, games, now).filter((row) => !row.isSelf).at(-1)?.teamId ?? null;
  }, [rows, games, now]);

  return {
    opponentId: current?.error !== undefined ? null : opponentId,
    error: current?.error ?? null,
  };
}
