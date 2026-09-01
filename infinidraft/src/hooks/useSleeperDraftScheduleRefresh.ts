import { useAction } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";

// Best-effort refresh of Sleeper's own scheduled draft start_time (see
// convex/sleeper/draftSync.ts's fetchSleeperDraftSchedule) - fired once per
// mount from every pre-draft surface that displays it (League Settings,
// Draft Room tabs), not the Dashboard (which only reads the cached value
// off listSeasons, to avoid hitting Sleeper once per league on every page
// load). Silently no-ops on failure - this is a passive background refresh,
// not a user-clicked action, so there's nothing useful to surface an error
// for.
export function useSleeperDraftScheduleRefresh(
  seasonId: Id<"seasons"> | undefined,
  sleeperLeagueId: string | undefined,
  enabled: boolean,
): void {
  const fetchSchedule = useAction(
    api.sleeper.draftSync.fetchSleeperDraftSchedule,
  );
  const firedForRef = useRef<Id<"seasons"> | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !seasonId || !sleeperLeagueId) return;
    if (firedForRef.current === seasonId) return;
    firedForRef.current = seasonId;
    void fetchSchedule({ seasonId }).catch(() => {});
  }, [enabled, seasonId, sleeperLeagueId, fetchSchedule]);
}
