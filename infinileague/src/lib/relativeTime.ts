// Small one-off, not a port of anything in infinidraft - the closest
// existing helper there (src/lib/sleeperDraftSchedule.ts's
// formatSleeperDraftSchedule) formats a scheduled *future* timestamp for
// display, not elapsed time since a past one, so it doesn't fit here.
export function formatRelativeTime(pastMs: number, nowMs = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((nowMs - pastMs) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}
