import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { isFpidEligible } from "./eligibility";

// Every currently-open cycle for a season - can now be more than one
// (at most one "weekly" plus any number of "playerDrop"/"manual"). Used
// wherever bids.ts used to look up "the" open cycle via .first().
export async function listOpenCyclesForSeason(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<Doc<"faAuctionCycles">[]> {
  return await ctx.db
    .query("faAuctionCycles")
    .withIndex("by_season_status", (q) => q.eq("seasonId", seasonId).eq("status", "open"))
    .collect();
}

// The single source of truth placeBid uses for "which open cycle (if any)
// is this fpid actually biddable under right now": a locked fpid always
// resolves to its own dedicated cycle (schema.ts's faAuctionFpidCycles
// invariant guarantees that cycle is open); otherwise falls back to the
// season's open weekly cycle, but only if this fpid currently satisfies
// eligibility.ts's weekly rule (kickoff passed, not locked elsewhere).
export async function resolveOpenCycleForFpid(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
  fpid: number,
): Promise<Doc<"faAuctionCycles"> | null> {
  const lock = await ctx.db
    .query("faAuctionFpidCycles")
    .withIndex("by_season_fpid", (q) => q.eq("seasonId", season._id).eq("fpid", fpid))
    .unique();
  if (lock) {
    const cycle = await ctx.db.get(lock.cycleId);
    return cycle && cycle.status === "open" ? cycle : null;
  }

  const weeklyCycle = await ctx.db
    .query("faAuctionCycles")
    .withIndex("by_season_type_status", (q) =>
      q.eq("seasonId", season._id).eq("type", "weekly").eq("status", "open"),
    )
    .first();
  if (!weeklyCycle) return null;
  return (await isFpidEligible(ctx, season, weeklyCycle, fpid)) ? weeklyCycle : null;
}
