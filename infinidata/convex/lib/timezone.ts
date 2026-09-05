// DST-safe "next occurrence of weekday/hour in a named timezone" helper -
// used by both convex/sleeper/transactions.ts (Sleeper's waiver-day-of-week
// clearing) and infinifaab's own weekly auction close schedule. No new
// dependency: the repo has no timezone library today, and Intl.DateTimeFormat
// (built into the JS runtime) is enough for this one job.

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function formatPartsAt(
  ms: number,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(
    ms,
  );
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// `formatPartsAt`'s return type is an index signature, so
// noUncheckedIndexedAccess treats every read as possibly-undefined even
// though Intl.DateTimeFormat always populates whichever parts were
// requested in `options` - this just narrows that back to `string` at the
// one point each caller reads a part it knows it asked for.
function requirePart(parts: Record<string, string>, type: string): string {
  const value = parts[type];
  if (value === undefined) {
    throw new Error(`Intl.DateTimeFormat didn't return a "${type}" part`);
  }
  return value;
}

// Converts "this calendar date, at hour:minute local wall-clock time in
// timeZone" into a real UTC instant - the standard round-trip-through-Intl
// trick: guess the instant as if `timeZone` were UTC, discover what that
// guess actually reads as in `timeZone` (revealing the real UTC offset),
// then correct by the difference. One correction pass is exact here (not
// iterative) because the offset can only shift by whole hours across a DST
// boundary, and this guess/correct pair never straddles one in practice for
// a single wall-clock instant.
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  const parts = formatPartsAt(guessUtc, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const asIfUtc = Date.UTC(
    Number(requirePart(parts, "year")),
    Number(requirePart(parts, "month")) - 1,
    Number(requirePart(parts, "day")),
    Number(requirePart(parts, "hour")),
    Number(requirePart(parts, "minute")),
    Number(requirePart(parts, "second")),
  );
  return guessUtc + (guessUtc - asIfUtc);
}

// The first UTC instant strictly after `after` that is `hour`:`minute`
// local time in `timeZone`, any day (today if that time hasn't passed yet,
// otherwise tomorrow) - the "Custom Daily Waivers" counterpart to
// nextWeeklyOccurrence below.
export function nextDailyOccurrence(
  after: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const probe = after + dayOffset * DAY_MS;
    const parts = formatPartsAt(probe, timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const candidate = zonedTimeToUtc(
      Number(requirePart(parts, "year")),
      Number(requirePart(parts, "month")),
      Number(requirePart(parts, "day")),
      hour,
      minute,
      timeZone,
    );
    if (candidate > after) return candidate;
  }
  throw new Error(
    "nextDailyOccurrence: no matching instant found within 3 days - this should never happen",
  );
}

// The first UTC instant strictly after `after` that is `weekday` (0=Sun..
// 6=Sat) at `hour`:`minute` local time in `timeZone`.
export function nextWeeklyOccurrence(
  after: number,
  weekday: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const DAY_MS = 24 * 60 * 60 * 1000;
  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const probe = after + dayOffset * DAY_MS;
    const parts = formatPartsAt(probe, timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    });
    if (WEEKDAY_INDEX[requirePart(parts, "weekday")] !== weekday) continue;
    const candidate = zonedTimeToUtc(
      Number(requirePart(parts, "year")),
      Number(requirePart(parts, "month")),
      Number(requirePart(parts, "day")),
      hour,
      minute,
      timeZone,
    );
    if (candidate > after) return candidate;
  }
  throw new Error(
    "nextWeeklyOccurrence: no matching day found within a week - this should never happen",
  );
}
