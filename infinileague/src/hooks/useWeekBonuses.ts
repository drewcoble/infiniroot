import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";

const NO_BONUSES: Record<string, number> = {};

// Each team's infiniyoffs stage bonus for the week (teamId -> points),
// added to its matchup score - see convex/infinileague/season/weekBonuses.ts.
// Empty while loading, on an error, or for a league with no custom
// playoff rules. Loaded once per week: tiers are set by then, and a
// bracket round's teams by the week before.
export function useWeekBonuses(
  seasonId: string | null,
  week: string | null,
): Record<string, number> {
  const getWeekBonuses = useAction(api.infinileague.season.weekBonuses.getWeekBonuses);
  const key = seasonId !== null && week !== null ? `${seasonId}:${week}` : null;
  const [result, setResult] = useState<{ key: string; bonuses: Record<string, number> } | null>(
    null,
  );
  useEffect(() => {
    if (seasonId === null || week === null || key === null) return;
    let cancelled = false;
    getWeekBonuses({ seasonId: seasonId as Id<"seasons">, week })
      .then((bonuses) => {
        if (!cancelled) setResult({ key, bonuses });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [seasonId, week, key, getWeekBonuses]);
  return result !== null && result.key === key ? result.bonuses : NO_BONUSES;
}
