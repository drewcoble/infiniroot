// Future-facing counterpart to a "time ago" formatter (infinileague's own
// relativeTime.ts is past-tense only, doesn't fit a cycle countdown) -
// small one-off for displaying "closes in Xh Ym" style auction timers.
export function formatCountdown(futureMs: number, nowMs = Date.now()): string {
  const diffSeconds = Math.max(0, Math.round((futureMs - nowMs) / 1000));
  if (diffSeconds <= 0) return "closing now";
  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "under a minute";
}
