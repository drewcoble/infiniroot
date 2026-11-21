import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import type { TeamRosterRow } from "@shared/league/types/season";

// Slots that can't be started - left out of the lineups.
const UNSTARTABLE_SLOTS = new Set(["IR", "TAXI"]);

export interface WeekLineups {
  // teamId -> lineup; undefined while loading.
  lineups: Map<string, TeamRosterRow[]> | undefined;
  error: string | null;
}

// Every team's lineup for the week (getWeekLineups), refetched every
// refreshMs while games are live - a failed refresh keeps the last ones.
// Tagged with the week it's for, so a week change reads as loading.
export function useWeekLineups(
  seasonId: string,
  week: string | null,
  refreshMs: number | null,
  enabled = true,
): WeekLineups {
  const getWeekLineups = useAction(api.infiniyoffs.reads.getWeekLineups);
  const key = week !== null && enabled ? `${seasonId}:${week}` : null;
  const [result, setResult] = useState<{
    key: string;
    lineups?: Map<string, TeamRosterRow[]>;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (key === null || week === null) return;
    let cancelled = false;
    const load = (isRefresh: boolean) =>
      getWeekLineups({ seasonId: seasonId as Id<"seasons">, week })
        .then((lineups) => {
          if (cancelled) return;
          const byTeam = new Map(
            lineups.map(({ teamId, rows }) => [
              teamId as string,
              rows.filter(
                (row) =>
                  !(row.slot && UNSTARTABLE_SLOTS.has(row.slot)) &&
                  !(row.fpid === undefined && row.slot === "BENCH"),
              ),
            ]),
          );
          setResult({ key, lineups: byTeam });
        })
        .catch((err) => {
          if (cancelled || isRefresh) return;
          setResult({ key, error: getErrorMessage(err, "Failed to load this week's lineups.") });
        });
    void load(false);
    const id = refreshMs !== null ? setInterval(() => void load(true), refreshMs) : null;
    return () => {
      cancelled = true;
      if (id !== null) clearInterval(id);
    };
  }, [seasonId, week, key, refreshMs, getWeekLineups]);

  const current = result !== null && result.key === key ? result : null;
  return { lineups: current?.lineups, error: current?.error ?? null };
}
