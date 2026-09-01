import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalAction,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { requireStripeEnv, retrievePrice } from "./stripeClient";

// Public, unauthenticated - the Pro plan's price isn't sensitive, and every
// "Go Pro" callout (UpgradePrompt, BillingPage) needs it regardless of
// whether the viewer is signed in yet. Returns null if nothing's cached yet
// (first-ever view, or STRIPE_PRO_PRICE_ID just rotated) - callers should
// pair this with ensureProPricingCached to backfill it, same "read cache,
// trigger a mutation to populate it" pattern the Report Card's AI recap
// uses (see convex/infinidraft/draft/reportCard.ts's ensureReportSummaryGenerated).
export const getProPricing = query({
  args: {},
  handler: async (ctx) => {
    let priceId: string;
    try {
      ({ priceId } = requireStripeEnv());
    } catch {
      // Stripe isn't configured in this deployment at all (e.g. a fresh
      // dev environment before STRIPE.md's setup) - no price to show,
      // rather than throwing and breaking every page with a "Go Pro"
      // callout on it.
      return null;
    }
    const cached = await ctx.db
      .query("proPricingCache")
      .withIndex("by_price_id", (q) => q.eq("priceId", priceId))
      .unique();
    if (!cached) return null;
    return {
      unitAmount: cached.unitAmount,
      currency: cached.currency,
      interval: cached.interval,
    };
  },
});

export const savePricing = internalMutation({
  args: {
    priceId: v.string(),
    unitAmount: v.number(),
    currency: v.string(),
    interval: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("proPricingCache")
      .withIndex("by_price_id", (q) => q.eq("priceId", args.priceId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, fetchedAt: Date.now() });
    } else {
      await ctx.db.insert("proPricingCache", {
        ...args,
        fetchedAt: Date.now(),
      });
    }
  },
});

// Best-effort, matching convex/infinidraft/gemini/reportSummary.ts's generateReportSummary
// - a failed fetch (bad key, Stripe outage) just leaves the cache empty
// rather than throwing anywhere a user would see it; callers already treat
// a null getProPricing result as "don't show a price yet".
export const fetchAndCachePricing = internalAction({
  args: {},
  handler: async (ctx) => {
    const { priceId } = requireStripeEnv();
    let price;
    try {
      price = await retrievePrice(priceId);
    } catch (err) {
      console.error("Failed to fetch Pro plan price from Stripe", err);
      return;
    }
    await ctx.runMutation(internal.infinidraft.billing.pricing.savePricing, {
      priceId: price.priceId,
      unitAmount: price.unitAmount,
      currency: price.currency,
      interval: price.interval,
    });
  },
});

// Called from the frontend whenever getProPricing comes back null - no-ops
// if this price id is already cached, so it's safe to call on every such
// view rather than just the first.
export const ensureProPricingCached = mutation({
  args: {},
  handler: async (ctx) => {
    let priceId: string;
    try {
      ({ priceId } = requireStripeEnv());
    } catch {
      return;
    }
    const existing = await ctx.db
      .query("proPricingCache")
      .withIndex("by_price_id", (q) => q.eq("priceId", priceId))
      .unique();
    if (existing) return;

    await ctx.scheduler.runAfter(
      0,
      internal.infinidraft.billing.pricing.fetchAndCachePricing,
      {},
    );
  },
});
