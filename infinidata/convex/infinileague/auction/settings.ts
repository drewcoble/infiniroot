import { v } from "convex/values";
import { mutation, query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireSeasonOwner, requireSeasonParticipant } from "../../lib/access";

// The only time zone infinifaab's auction schedule ever runs on - not a
// per-league setting. Not exposed as a mutation arg at all (see
// updateAuctionSettings below), so there's no client-facing path that could
// ever write a different value here, not just a UI that happens to hide the
// control.
const AUCTION_TIME_ZONE = "America/New_York";

// Sensible defaults for a season that's never configured the auction
// before - Tuesday 10pm Eastern, $1 minimum bid/increment, 5-minute
// anti-snipe, earliest-bid-wins tiebreak, 48h Sleeper drop-cycle window.
// Never written on their own; only used to seed a real faAuctionSettings
// row the first time the commissioner opens Settings or saves a change.
const DEFAULT_SETTINGS = {
  enabled: false,
  closeWeekday: 2, // Tuesday
  closeHour: 22,
  closeMinute: 0,
  timeZone: AUCTION_TIME_ZONE,
  minIncrement: 1,
  startingBid: 1,
  antiSnipeMinutes: 5,
  tieBreakMode: "earliest" as const,
  dropCycleDurationHours: 48,
};

type AuctionSettingsPayload = Omit<
  Doc<"faAuctionSettings">,
  "_id" | "_creationTime" | "seasonId" | "dropCycleDurationHours"
> & { dropCycleDurationHours: number };

// Any participant can read the settings (they need closesAt/tieBreakMode
// context on the board), but only the commissioner can change them.
// dropCycleDurationHours is normalized to a concrete number here (added
// after launch as v.optional, see schema.ts) so no caller has to repeat the
// `?? 48` fallback.
export const getAuctionSettings = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<AuctionSettingsPayload> => {
    await requireSeasonParticipant(ctx, args.seasonId);
    const existing = await ctx.db
      .query("faAuctionSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
      .unique();
    if (!existing) return DEFAULT_SETTINGS;
    return {
      ...existing,
      dropCycleDurationHours:
        existing.dropCycleDurationHours ?? DEFAULT_SETTINGS.dropCycleDurationHours,
    };
  },
});

// No timeZone arg - deliberately not client-settable at all (see
// AUCTION_TIME_ZONE above). closeHour/closeMinute are still stored/
// interpreted as Eastern wall-clock time regardless of what the caller's
// own local time zone is.
export const updateAuctionSettings = mutation({
  args: {
    seasonId: v.id("seasons"),
    enabled: v.boolean(),
    closeWeekday: v.number(),
    closeHour: v.number(),
    closeMinute: v.number(),
    minIncrement: v.number(),
    startingBid: v.number(),
    antiSnipeMinutes: v.number(),
    tieBreakMode: v.union(v.literal("earliest"), v.literal("waiverOrder")),
    dropCycleDurationHours: v.number(),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const { seasonId, ...fields } = args;
    const existing = await ctx.db
      .query("faAuctionSettings")
      .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, timeZone: AUCTION_TIME_ZONE });
    } else {
      await ctx.db.insert("faAuctionSettings", {
        seasonId,
        ...fields,
        timeZone: AUCTION_TIME_ZONE,
      });
    }
  },
});
