import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { positionValidator } from "./positions";

// Every fpid we've ever chosen to track (populated by upsertPlayers below,
// so it never grows beyond "players we decided were roster-relevant").
// Internal-only: used by convex/sleeper/playerPoints.ts to drop stat rows
// for a player we don't otherwise have a record of, rather than by any
// client-facing list, so a full collect() here stays bounded by that same
// roster-relevant set rather than the unbounded Sleeper payload.
export const listKnownFpids = internalQuery({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    return players.map((player) => player.fpid);
  },
});

export const getPlayer = query({
  args: { fpid: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("players")
      .withIndex("by_fpid", (q) => q.eq("fpid", args.fpid))
      .first();
  },
});

// Bulk counterpart to getPlayer, for a roster-sized list of fpids (e.g.
// convex/infinileague/season/teamRoster.ts joining a team's ~15-20 players against their
// name/position/team). No indexed "IN" query exists in Convex, and nothing
// else in this codebase does a bulk-by-indexed-field lookup either - a
// Promise.all of individual by_fpid point lookups is plenty fast at this
// size and keeps this consistent with getPlayer's own index usage.
export const getPlayersByFpids = query({
  args: { fpids: v.array(v.number()) },
  handler: async (ctx, args) => {
    const players = await Promise.all(
      args.fpids.map((fpid) =>
        ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", fpid))
          .first(),
      ),
    );
    return players.filter((player) => player !== null);
  },
});

export const upsertPlayers = mutation({
  args: {
    rows: v.array(
      v.object({
        fpid: v.number(),
        name: v.string(),
        position: positionValidator,
        team: v.union(v.string(), v.null()),
        yearsExp: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("players")
        .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          name: row.name,
          position: row.position,
          team: row.team,
          ...(row.yearsExp !== undefined ? { yearsExp: row.yearsExp } : {}),
          updatedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("players", {
          fpid: row.fpid,
          name: row.name,
          position: row.position,
          team: row.team,
          ...(row.yearsExp !== undefined ? { yearsExp: row.yearsExp } : {}),
          updatedAt: now,
        });
        inserted += 1;
      }
    }

    return { inserted, updated };
  },
});

// Backfills espnId/yahooId onto players we already track (see convex/
// sleeper/playerLinks.ts) - never inserts a new player row, since identity
// (name/position/team) is owned by upsertPlayers above; an fpid this app
// hasn't seen yet (e.g. a deep practice-squad player Sleeper's full player
// list includes but our projections fetch filtered out) is silently
// skipped rather than seeded from partial data.
export const patchExternalIds = internalMutation({
  args: {
    rows: v.array(
      v.object({
        fpid: v.number(),
        espnId: v.optional(v.number()),
        yahooId: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let patched = 0;
    let skipped = 0;

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("players")
        .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
        .first();

      if (!existing) {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(existing._id, {
        ...(row.espnId !== undefined ? { espnId: row.espnId } : {}),
        ...(row.yahooId !== undefined ? { yahooId: row.yahooId } : {}),
      });
      patched += 1;
    }

    return { patched, skipped };
  },
});

// Records each player's position on a platform (see schema.ts's
// platformPositions): kept only where it differs from players.position,
// deleted once it matches again (Sleeper caught up, or the platform moved
// him back). Unknown fpids are skipped.
export const recordPlatformPositions = internalMutation({
  args: {
    platform: v.union(v.literal("espn"), v.literal("yahoo")),
    rows: v.array(v.object({ fpid: v.number(), position: positionValidator })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const row of args.rows) {
      const [player, existing] = await Promise.all([
        ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
          .first(),
        ctx.db
          .query("platformPositions")
          .withIndex("by_platform_fpid", (q) =>
            q.eq("platform", args.platform).eq("fpid", row.fpid),
          )
          .first(),
      ]);
      if (!player) continue;
      if (player.position === row.position) {
        if (existing) await ctx.db.delete(existing._id);
      } else if (!existing) {
        await ctx.db.insert("platformPositions", {
          fpid: row.fpid,
          platform: args.platform,
          position: row.position,
          updatedAt: now,
        });
      } else if (existing.position !== row.position) {
        await ctx.db.patch(existing._id, { position: row.position, updatedAt: now });
      }
    }
  },
});

// Action-side counterpart to lib/platformPosition.ts's
// loadPlatformPositions, which takes a QueryCtx.
export const listPlatformPositions = internalQuery({
  args: { platform: v.union(v.literal("espn"), v.literal("yahoo")) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("platformPositions")
      .withIndex("by_platform_fpid", (q) => q.eq("platform", args.platform))
      .collect();
    return rows.map((row) => ({ fpid: row.fpid, position: row.position }));
  },
});

// Full name/position/espnId for every tracked player - the candidate pool
// convex/espn/rankings.ts loads once and matches an external source's
// players against in memory (name+position, for rows that don't already
// carry a matching espnId), rather than issuing one query per external
// player. Bounded by the same "roster-relevant players only" set as
// listKnownFpids above.
export const listForNameMatch = internalQuery({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    return players.map((player) => ({
      fpid: player.fpid,
      name: player.name,
      position: player.position,
      team: player.team,
      espnId: player.espnId,
    }));
  },
});

// Rookie fpids (years_exp === 0), for badge lookups anywhere a player row
// only carries an fpid (projections/draftValues/faabValues rows all
// snapshot identity independently and don't otherwise carry yearsExp) - see
// src/hooks/useRookieFpids.ts, the sole client of this query.
export const getRookieFpids = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db.query("players").collect();
    return players
      .filter((player) => player.yearsExp === 0)
      .map((player) => player.fpid);
  },
});
