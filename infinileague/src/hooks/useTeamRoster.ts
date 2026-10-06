import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import type { TeamRosterRow } from "../types/season";

// Thin wrapper around the teamRoster action (the same one teams/$teamId.tsx
// calls directly) - re-fetches whenever teamId/week change, null-safe so
// callers can pass a not-yet-known teamId without an extra guard at every
// call site. Shared by the Trade and Matchup tabs, which both line up two
// teams' rosters side by side.
//
// refreshMs (Matchup tab, only while games are live) re-runs the action on
// that interval so actual points keep up with the game. A refresh keeps the
// current rows on screen until the new ones land, and a failed refresh
// keeps them too rather than replacing the roster with an error.
// Results are tagged with the teamId/week they were fetched for and only
// returned while those still match - switching team or week reads as
// loading (rows undefined) straight away instead of briefly showing the
// previous team's roster, and a slow response for an old team/week can
// never land over the current one.
export function useTeamRoster(
  teamId: string | null,
  week: string | null,
  refreshMs: number | null = null,
) {
  const getTeamRosterForWeek = useAction(api.infinileague.season.teamRoster.getTeamRosterForWeek);
  const key = teamId !== null && week !== null ? `${teamId}:${week}` : null;
  const [result, setResult] = useState<{
    key: string;
    rows?: TeamRosterRow[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (teamId === null || week === null || key === null) return;
    let cancelled = false;
    getTeamRosterForWeek({ teamId: teamId as Id<"seasonTeams">, week })
      .then((rows) => {
        if (!cancelled) setResult({ key, rows });
      })
      .catch((err) => {
        if (!cancelled) setResult({ key, error: getErrorMessage(err, "Failed to load roster.") });
      });
    return () => {
      cancelled = true;
    };
  }, [teamId, week, key, getTeamRosterForWeek]);

  useEffect(() => {
    if (teamId === null || week === null || key === null || refreshMs === null) return;
    let cancelled = false;
    const id = setInterval(() => {
      getTeamRosterForWeek({ teamId: teamId as Id<"seasonTeams">, week })
        .then((rows) => {
          if (!cancelled) setResult({ key, rows });
        })
        .catch(() => {});
    }, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [teamId, week, key, refreshMs, getTeamRosterForWeek]);

  const current = result !== null && result.key === key ? result : null;
  return { rows: current?.rows, error: current?.error ?? null };
}
