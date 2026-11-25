import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

const NO_ADJUSTMENTS: Record<string, number> = {};

// Points a commissioner added to each team's score by hand on the platform
// (teamId -> points), added to its matchup score - see
// convex/infinileague/season/weekAdjustments.ts. Empty while loading, on an
// error, or for a league without any. refreshMs re-fetches while games are
// live, same as useTeamRoster - a failed refresh keeps the last values.
export function useWeekAdjustments(
  seasonId: string | null,
  week: string | null,
  refreshMs: number | null = null,
): Record<string, number> {
  const getWeekAdjustments = useAction(api.infinileague.season.weekAdjustments.getWeekAdjustments);
  const key = seasonId !== null && week !== null ? `${seasonId}:${week}` : null;
  const [result, setResult] = useState<{
    key: string;
    adjustments: Record<string, number>;
  } | null>(null);
  useEffect(() => {
    if (seasonId === null || week === null || key === null) return;
    let cancelled = false;
    const load = () =>
      getWeekAdjustments({ seasonId: seasonId as Id<"seasons">, week })
        .then((adjustments) => {
          if (!cancelled) setResult({ key, adjustments });
        })
        .catch((err: unknown) => console.error("useWeekAdjustments: load failed", err));
    void load();
    const id = refreshMs !== null ? setInterval(() => void load(), refreshMs) : null;
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
  }, [seasonId, week, key, refreshMs, getWeekAdjustments]);
  return result !== null && result.key === key ? result.adjustments : NO_ADJUSTMENTS;
}
