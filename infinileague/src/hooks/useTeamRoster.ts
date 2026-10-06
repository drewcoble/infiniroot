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
export function useTeamRoster(
  teamId: string | null,
  week: string | null,
  refreshMs: number | null = null,
) {
  const getTeamRosterForWeek = useAction(
    api.infinileague.season.teamRoster.getTeamRosterForWeek,
  );
  const [rows, setRows] = useState<TeamRosterRow[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (teamId === null || week === null) return;
    setRows(undefined);
    setError(null);
    getTeamRosterForWeek({ teamId: teamId as Id<"seasonTeams">, week })
      .then(setRows)
      .catch((err) => setError(getErrorMessage(err, "Failed to load roster.")));
  }, [teamId, week, getTeamRosterForWeek]);

  useEffect(() => {
    if (teamId === null || week === null || refreshMs === null) return;
    // Guards against a refresh that resolves after the team/week changed
    // writing the old team's roster over the new one.
    let cancelled = false;
    const id = setInterval(() => {
      getTeamRosterForWeek({ teamId: teamId as Id<"seasonTeams">, week })
        .then((next) => {
          if (!cancelled) setRows(next);
        })
        .catch(() => {});
    }, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [teamId, week, refreshMs, getTeamRosterForWeek]);

  return { rows, error };
}
