import { v } from "convex/values";
import { internalMutation, mutation, MutationCtx } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "../_generated/dataModel";

const subscriptionStatusValidator = v.union(
  v.literal("none"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("unpaid"),
);

// Idempotency guard - Stripe delivers webhooks at-least-once, so
// convex/billing/webhookHandler.ts claims each event id before acting on it
// and skips anything already processed.
export const claimWebhookEvent = internalMutation({
  args: { stripeEventId: v.string(), type: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("stripeEventId", args.stripeEventId))
      .unique();
    if (existing) return false;
    await ctx.db.insert("stripeWebhookEvents", {
      stripeEventId: args.stripeEventId,
      type: args.type,
      processedAt: Date.now(),
    });
    return true;
  },
});

async function findSubscriptionRow(
  ctx: MutationCtx,
  args: {
    userId?: Id<"users"> | undefined;
    stripeCustomerId?: string | undefined;
    stripeSubscriptionId?: string | undefined;
  },
) {
  const { stripeSubscriptionId, stripeCustomerId, userId } = args;
  if (stripeSubscriptionId) {
    const bySubscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", stripeSubscriptionId),
      )
      .unique();
    if (bySubscription) return bySubscription;
  }
  if (stripeCustomerId) {
    const byCustomer = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) =>
        q.eq("stripeCustomerId", stripeCustomerId),
      )
      .unique();
    if (byCustomer) return byCustomer;
  }
  if (userId) {
    const byUser = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (byUser) return byUser;
  }
  return null;
}

// Links a Stripe customer to the app user who started checkout (from the
// Checkout Session's client_reference_id) - fired by checkout.session.
// completed, ahead of/alongside the customer.subscription.created event
// which carries the actual plan/status details (see applySubscriptionUpdate).
export const upsertCustomerId = internalMutation({
  args: { userId: v.id("users"), stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    const existing = await findSubscriptionRow(ctx, { userId: args.userId });
    if (existing) {
      if (existing.stripeCustomerId !== args.stripeCustomerId) {
        await ctx.db.patch(existing._id, {
          stripeCustomerId: args.stripeCustomerId,
          updatedAt: Date.now(),
        });
      }
      return;
    }
    await ctx.db.insert("subscriptions", {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      status: "none",
      comped: false,
      updatedAt: Date.now(),
    });
  },
});

// Upserts the full subscription snapshot from a customer.subscription.
// created/updated webhook. Resolves the target row by stripeSubscriptionId
// first (most authoritative once linked), falling back to stripeCustomerId
// or the userId carried in the subscription's own metadata (set at checkout
// time - see stripeClient.createCheckoutSession's subscription_data.
// metadata.userId) for the very first event on a brand-new subscription.
export const applySubscriptionUpdate = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    priceId: v.string(),
    status: subscriptionStatusValidator,
    currentPeriodEnd: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await findSubscriptionRow(ctx, {
      userId: args.userId,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
    const fields = {
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      priceId: args.priceId,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      updatedAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return;
    }
    if (!args.userId) {
      throw new Error(
        `No existing subscription row to update for Stripe subscription ${args.stripeSubscriptionId}, and no userId to create one.`,
      );
    }
    await ctx.db.insert("subscriptions", {
      userId: args.userId,
      comped: false,
      ...fields,
    });
  },
});

// customer.subscription.deleted - Stripe's final word that a subscription is
// gone (after cancel_at_period_end completes, or dunning is fully
// exhausted). No-op if we never saw it (shouldn't happen in practice).
export const markSubscriptionCanceled = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await findSubscriptionRow(ctx, {
      stripeSubscriptionId: args.stripeSubscriptionId,
    });
    if (!existing) return;
    await ctx.db.patch(existing._id, {
      status: "canceled",
      updatedAt: Date.now(),
    });
  },
});

// Super-admin-only: grants (or revokes) comped Pro access to a specific
// user, independent of any real Stripe subscription - see
// convex/billing/entitlements.ts's hasProAccess for how the two coexist.
export const setCompAccess = mutation({
  args: {
    targetUserId: v.id("users"),
    comped: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const callerUserId = await getAuthUserId(ctx);
    if (!callerUserId) {
      throw new Error("You must be signed in.");
    }
    const callerProfile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user_id", (q) => q.eq("userId", callerUserId))
      .unique();
    if (callerProfile?.role !== "super-admin") {
      throw new Error("Only super-admins can grant comped access.");
    }

    const existing = await findSubscriptionRow(ctx, { userId: args.targetUserId });
    const compFields = {
      comped: args.comped,
      compedBy: callerProfile._id,
      compedAt: Date.now(),
      updatedAt: Date.now(),
      ...(args.note !== undefined ? { compedNote: args.note } : {}),
    };
    if (existing) {
      await ctx.db.patch(existing._id, compFields);
      return;
    }
    await ctx.db.insert("subscriptions", {
      userId: args.targetUserId,
      status: "none",
      ...compFields,
    });
  },
});
