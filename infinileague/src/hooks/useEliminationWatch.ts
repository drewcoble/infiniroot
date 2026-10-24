import { useEffect, useMemo, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import { rankLive, type LiveEliminationRow } from "../lib/eliminationWatch";
import type { WeekGame } from "../lib/liveGames";
import type { EliminationWatchRow } from "../types/season";

// A guillotine league's Elimination Watch for one week - every still-active
// team's set lineup, re-ranked by live projection as games are played (see
// lib/eliminationWatch.ts's rankLive) with each team's cut / bubble / safe
// status. Shared by the guillotine Matchup tab's opponent pick
// (useGuillotineOpponent) and the team page header's status badge.
//
// seasonId null = not a guillotine league (or not known yet), skipped.
// rows: undefined = still loading (or skipped, or failed - see error).
// refreshMs re-fetches every lineup on that interval while games are live,
// same as useTeamRoster.
export function useEliminationWatch(
  seasonId: string | null,
  week: string | null,
  games: WeekGame[] | undefined,
  now: number,
  refreshMs: number | null = null,
  errorMessage = "Failed to load Elimination Watch.",
): { rows: LiveEliminationRow[] | undefined; error: string | null } {
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
            setResult({ key, error: getErrorMessage(err, errorMessage) });
          }
        });
    void load(true);
    const id = refreshMs !== null ? setInterval(() => void load(false), refreshMs) : undefined;
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [seasonId, week, key, refreshMs, getEliminationWatch, errorMessage]);

  const current = result !== null && result.key === key ? result : null;
  const fetched = current?.rows;
  const rows = useMemo(
    () => (fetched === undefined ? undefined : rankLive(fetched, games, now)),
    [fetched, games, now],
  );
  return { rows, error: current?.error ?? null };
}
