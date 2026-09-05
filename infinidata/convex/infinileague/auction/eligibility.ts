import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";

/**
 * Single source of truth for "is this fpid biddable right now" - used by
 * players.ts (the Players tab list), bids.ts (placeBid) and cycles.ts
 * (closeCycle's re-check), which must never disagree: a player rejected by
 * placeBid must never have been shown as biddable in the first place.
 *
 * Sleeper: real-world testing against a live FAAB league (Shadynasty's)
 * showed the original design - deriving "on waivers" from drop-transaction
 * history (convex/sleeper/transactions.ts) - was wrong. That only ever
 * covers players who were rostered-then-dropped THIS season; it silently
 * excludes the much larger pool of players who've simply never been
 * rostered/dropped at all (the majority of any real waiver pool, even more
 * so early in a season). In practice, a Sleeper league running any real
 * waiver system (FAAB or priority) requires a claim for essentially every
 * currently-unrostered player at any given time - there's no reliable
 * separate "instant free agent" carve-out worth modeling. So eligibility
 * here is simply "not currently rostered", matching what Sleeper's own UI
 * actually shows. convex/sleeper/transactions.ts's drop-based computation
 * is no longer wired into eligibility (see convex/crons.ts) - parked, not
 * deleted, in case a future need (e.g. a priority-waiver league where the
 * distinction matters more) brings it back.
 *
 * Yahoo: unchanged - a real, live signal from the platform itself
 * (`;status=W`, convex/infinidraft/yahoo/waivers.ts), not derived.
 */
export async function getEligibleFpidSet(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Set<number>> {
  if (season.sleeperLeagueId !== undefined) {
    const [allPlayers, rosteredRows] = await Promise.all([
      ctx.db.query("players").collect(),
      ctx.db
        .query("rosterPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", season._id))
        .collect(),
    ]);
    const rosteredFpids = new Set(rosteredRows.map((r) => r.fpid));
    return new Set(
      allPlayers.map((p) => p.fpid).filter((fpid) => !rosteredFpids.has(fpid)),
    );
  }

  const now = Date.now();
  const waiverRows = await ctx.db
    .query("waiverPlayers")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .collect();
  return new Set(
    waiverRows
      .filter((row) => row.clearsAt === undefined || row.clearsAt > now)
      .map((row) => row.fpid),
  );
}

export async function isFpidEligible(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
  fpid: number,
): Promise<boolean> {
  if (season.sleeperLeagueId !== undefined) {
    const rosteredRows = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    return !rosteredRows.some((r) => r.fpid === fpid);
  }

  const now = Date.now();
  const waiverRow = await ctx.db
    .query("waiverPlayers")
    .withIndex("by_season_fpid", (q) =>
      q.eq("seasonId", season._id).eq("fpid", fpid),
    )
    .unique();
  return waiverRow !== null && (waiverRow.clearsAt === undefined || waiverRow.clearsAt > now);
}
