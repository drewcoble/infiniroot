import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

// A league's weekly-elimination format, orthogonal to draftType.ts's
// DraftType - a guillotine league still drafts snake or auction, it just
// also cuts the lowest weekly optimal-lineup score every week (see
// convex/infinileague/season/eliminationWatch.ts).
export const leagueTypeValidator = v.union(
  v.literal("redraft"),
  v.literal("guillotine"),
);

export type LeagueType = "redraft" | "guillotine";

// Optional on seasons for the same reason draftType is (see schema.ts's
// comment on seasons.draftType and draftType.ts's resolveDraftType) -
// existing rows predate this field, absence means "redraft" (i.e. exactly
// pre-feature behavior) rather than a backfill migration.
export function resolveLeagueType(
  season: Pick<Doc<"seasons">, "leagueType">,
): LeagueType {
  return season.leagueType ?? "redraft";
}
