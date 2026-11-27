import type { GroupStage, PlayoffFormat } from "./format";

// What a rules change keeps: a matchup draft or hand-set groups survive a
// save that leaves their group stage alone (a bonus tweak, a toilet bowl),
// so only a change that really moves them throws them away.

// JSON with object keys sorted - the database returns keys sorted, so
// formats compare by this rather than by plain JSON.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );
}

export function sameFormat(a: PlayoffFormat | null, b: PlayoffFormat | null): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function groupStage(format: PlayoffFormat | null, stageId: string): GroupStage | null {
  const stage = format?.stages.find((s) => s.id === stageId);
  return stage?.kind === "groups" ? stage : null;
}

// Hand-set groups fit while the stage has the same groups and weeks.
export function keepsManualGroups(
  prev: PlayoffFormat | null,
  next: PlayoffFormat | null,
  stageId: string,
): boolean {
  const before = groupStage(prev, stageId);
  const after = groupStage(next, stageId);
  return (
    before !== null &&
    after !== null &&
    before.groupCount === after.groupCount &&
    canonicalJson(before.weeks) === canonicalJson(after.weeks)
  );
}

// A draft holds while its drafters (the seeds, so the regular season,
// seeding and tiers) and the stage itself, bonus aside, are unchanged.
export function keepsDraft(
  prev: PlayoffFormat | null,
  next: PlayoffFormat | null,
  stageId: string,
): boolean {
  const before = groupStage(prev, stageId);
  const after = groupStage(next, stageId);
  if (!prev || !next || !before || !after) return false;
  const drafters = (format: PlayoffFormat, stage: GroupStage) =>
    canonicalJson({
      end: format.regularSeasonEndWeek,
      seeding: format.seeding,
      tiers: format.tiers,
      stage: { ...stage, bonus: null },
    });
  return drafters(prev, before) === drafters(next, after);
}
