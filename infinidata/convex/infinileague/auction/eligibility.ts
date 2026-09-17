import type { QueryCtx, MutationCtx } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { normalizeTank01Team } from "../../tank01/client";

export type CycleType = "weekly" | "playerDrop" | "manual";

// cycleId/closesAt are only absent for a "weekly"-tagged row when no weekly
// cycle happens to be open right now (auction disabled, or the brief gap
// before ensureAuctionCycles' next tick reopens one) - the player still
// shows up as eligible (matches this app's long-standing "show the waiver
// board even with no live cycle, just disable bidding" UX), it's just not
// bid-able yet. A "playerDrop"/"manual" row always has both, since a
// faAuctionFpidCycles lock row only ever exists while its cycle is open.
export interface EligibleCycleRef {
  cycleType: CycleType;
  cycleId?: Id<"faAuctionCycles">;
  closesAt?: number;
}

/**
 * Single source of truth for "is this fpid biddable right now, and under
 * which cycle" - used by players.ts (the Players tab list), bids.ts
 * (placeBid) and cycles.ts (closeCycle's re-check), which must never
 * disagree: a player rejected by placeBid must never have been shown as
 * biddable in the first place.
 *
 * Sleeper has three distinct ways a player becomes bid-eligible (see the
 * plan this shipped from - "Multi-cycle Sleeper waiver eligibility"):
 *
 * 1. Weekly cycle, game-start gated: an unrostered player joins the always-
 *    open weekly cycle once their CURRENT NFL WEEK game has kicked off
 *    (getCurrentWeekKickoffByFpid below), staying eligible until that
 *    cycle's own close - not the moment they become unrostered. Before
 *    kickoff they're hidden entirely (no "pending" state).
 * 2. Drop-triggered dedicated cycle (sleeper/transactions.ts's
 *    detectSleeperDrops): scopes a single fpid to its own cycle for a
 *    bounded window, deliberately WITHOUT the kickoff gate - a real drop
 *    event is a distinct, bounded-window signal from the general
 *    always-unrostered pool rule 1 gates.
 * 3. Commissioner manual cycle (cycles.ts's startManualAuctionCycle): same
 *    "no kickoff gate, just unrostered" rule as #2.
 *
 * A locked fpid (convex/schema.ts's faAuctionFpidCycles - scoped to an open
 * playerDrop/manual cycle) is never simultaneously counted under the weekly
 * cycle - the whole point of that table is one open cycle per fpid at a
 * time.
 *
 * Yahoo: unchanged - a real, live signal from the platform itself
 * (`;status=W`, convex/infinidraft/yahoo/waivers.ts), not derived. Yahoo
 * seasons never have playerDrop/manual cycles.
 */

async function getCurrentWeekKickoffByTeam(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Map<string, number>> {
  const nflState = await ctx.db.query("nflState").first();
  if (!nflState) return new Map();

  const games = await ctx.db
    .query("nflGames")
    .withIndex("by_season_week", (q) =>
      q.eq("season", season.year).eq("week", String(nflState.week)),
    )
    .collect();

  const kickoffByTeam = new Map<string, number>();
  for (const game of games) {
    kickoffByTeam.set(normalizeTank01Team(game.homeTeam), game.kickoffAt);
    kickoffByTeam.set(normalizeTank01Team(game.awayTeam), game.kickoffAt);
  }
  return kickoffByTeam;
}

// Exported so sleeper/transactions.ts's drop detector can reuse the exact
// same "has this fpid's current-week game kicked off" lookup for its own
// fold-into-weekly exception check - must never drift from what this file
// uses for rule 1 itself.
export async function getCurrentWeekKickoffByFpid(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Map<number, number>> {
  const [kickoffByTeam, players] = await Promise.all([
    getCurrentWeekKickoffByTeam(ctx, season),
    ctx.db.query("players").collect(),
  ]);
  const kickoffByFpid = new Map<number, number>();
  for (const player of players) {
    if (!player.team) continue;
    const kickoffAt = kickoffByTeam.get(player.team);
    if (kickoffAt !== undefined) kickoffByFpid.set(player.fpid, kickoffAt);
  }
  return kickoffByFpid;
}

// Every fpid currently locked to an open playerDrop/manual cycle, tagged
// with that cycle's own type/closesAt - by invariant (schema.ts's
// faAuctionFpidCycles comment) a lock row only exists while its cycle is
// open, so this never needs to filter out stale/closed cycles defensively.
async function getLockedFpidCycles(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Map<number, EligibleCycleRef>> {
  const lockRows = await ctx.db
    .query("faAuctionFpidCycles")
    .withIndex("by_season", (q) => q.eq("seasonId", season._id))
    .collect();

  const result = new Map<number, EligibleCycleRef>();
  for (const row of lockRows) {
    const cycle = await ctx.db.get(row.cycleId);
    if (!cycle) continue;
    result.set(row.fpid, {
      cycleType: cycle.type ?? "weekly",
      cycleId: cycle._id,
      closesAt: cycle.closesAt,
    });
  }
  return result;
}

async function getOpenWeeklyCycle(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<Doc<"faAuctionCycles"> | null> {
  return await ctx.db
    .query("faAuctionCycles")
    .withIndex("by_season_type_status", (q) =>
      q.eq("seasonId", seasonId).eq("type", "weekly").eq("status", "open"),
    )
    .first();
}

export async function getEligibleFpidSet(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Map<number, EligibleCycleRef>> {
  if (season.sleeperLeagueId !== undefined) {
    const [allPlayers, rosteredRows, kickoffByFpid, lockedFpidCycles, weeklyCycle] =
      await Promise.all([
        ctx.db.query("players").collect(),
        ctx.db
          .query("rosterPlayers")
          .withIndex("by_season", (q) => q.eq("seasonId", season._id))
          .collect(),
        getCurrentWeekKickoffByFpid(ctx, season),
        getLockedFpidCycles(ctx, season),
        getOpenWeeklyCycle(ctx, season._id),
      ]);
    const rosteredFpids = new Set(rosteredRows.map((r) => r.fpid));
    const now = Date.now();

    const result = new Map<number, EligibleCycleRef>();
    for (const player of allPlayers) {
      if (rosteredFpids.has(player.fpid)) continue;
      // Owned by its own dedicated cycle instead - never double-counted
      // under the weekly cycle at the same time.
      if (lockedFpidCycles.has(player.fpid)) continue;
      const kickoffAt = kickoffByFpid.get(player.fpid);
      if (kickoffAt === undefined || kickoffAt > now) continue;
      result.set(player.fpid, {
        cycleType: "weekly",
        ...(weeklyCycle ? { cycleId: weeklyCycle._id, closesAt: weeklyCycle.closesAt } : {}),
      });
    }
    for (const [fpid, ref] of lockedFpidCycles) {
      result.set(fpid, ref);
    }
    return result;
  }

  const now = Date.now();
  const [waiverRows, weeklyCycle] = await Promise.all([
    ctx.db
      .query("waiverPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect(),
    getOpenWeeklyCycle(ctx, season._id),
  ]);
  const result = new Map<number, EligibleCycleRef>();
  for (const row of waiverRows) {
    if (row.clearsAt !== undefined && row.clearsAt <= now) continue;
    result.set(row.fpid, {
      cycleType: "weekly",
      ...(weeklyCycle ? { cycleId: weeklyCycle._id, closesAt: weeklyCycle.closesAt } : {}),
    });
  }
  return result;
}

export async function isFpidEligible(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
  cycle: Doc<"faAuctionCycles">,
  fpid: number,
): Promise<boolean> {
  if (season.sleeperLeagueId !== undefined) {
    const rosteredRows = await ctx.db
      .query("rosterPlayers")
      .withIndex("by_season", (q) => q.eq("seasonId", season._id))
      .collect();
    if (rosteredRows.some((r) => r.fpid === fpid)) return false;

    const cycleType = cycle.type ?? "weekly";
    if (cycleType !== "weekly") {
      // Dedicated cycles (playerDrop/manual): no kickoff gate, just
      // "still unrostered" - see this file's header comment for why.
      return true;
    }

    // Weekly: kickoff must have passed, AND the fpid must not have since
    // been claimed by its own dedicated cycle mid-week (the safety net
    // that voids a stale weekly bid if a drop/manual cycle scooped this
    // player up after the bid was placed).
    const lock = await ctx.db
      .query("faAuctionFpidCycles")
      .withIndex("by_season_fpid", (q) => q.eq("seasonId", season._id).eq("fpid", fpid))
      .unique();
    if (lock) return false;

    const kickoffByFpid = await getCurrentWeekKickoffByFpid(ctx, season);
    const kickoffAt = kickoffByFpid.get(fpid);
    return kickoffAt !== undefined && kickoffAt <= Date.now();
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
