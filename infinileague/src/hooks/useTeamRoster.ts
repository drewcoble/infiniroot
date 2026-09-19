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
export function useTeamRoster(teamId: string | null, week: string | null) {
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

  return { rows, error };
}
