// Shared formatting for drafts.sleeperDraftScheduledAt (unix ms, cached from
// Sleeper's own draft start_time - see convex/sleeper/draftSync.ts's
// fetchSleeperDraftSchedule) across the Dashboard/Settings/Draft Room, so a
// scheduled draft time reads identically everywhere it shows up.
export function formatSleeperDraftSchedule(scheduledAt: number): string {
  return new Date(scheduledAt).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
