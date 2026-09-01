import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

// See SNAKE_DRAFT.md's §2 for the full design. "linear" is a straight
// round-robin snake variant with no direction bounce - some casual leagues
// draft this way, and Sleeper models it as a distinct `type`, not a variant
// of "snake".
export const draftTypeValidator = v.union(
  v.literal("auction"),
  v.literal("snake"),
  v.literal("linear"),
);

export type DraftType = "auction" | "snake" | "linear";

// The season's draftType is optional (see schema.ts's comment on
// seasons.draftType) - existing rows predate this field, and rather than a
// backfill migration to a required field, absence is treated as "auction"
// everywhere, mirroring how seasons.teScoring/sixPointPassTds already stay
// optional forever with an absent-means-default convention. A draft's own
// draftType (when set - only ever useful for a mock draft testing a
// different format than its season) overrides the season's.
export function resolveDraftType(
  season: Pick<Doc<"seasons">, "draftType">,
  draft?: Pick<Doc<"drafts">, "draftType">,
): DraftType {
  return draft?.draftType ?? season.draftType ?? "auction";
}
