"use node";

import Stripe from "stripe";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireStripeEnv } from "./stripeClient";

// Our subscriptions.status union (convex/schema.ts) deliberately omits
// Stripe's "trialing" (this app has no trial - see plan) and "paused"
// (a merchant-initiated pause_collection, not a payment failure) statuses.
// Map both to values our access check (hasProAccess) treats as safe
// defaults rather than rejecting the webhook outright.
type AppSubscriptionStatus =
  | "none"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

const KNOWN_APP_STATUSES: readonly AppSubscriptionStatus[] = [
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
];

function toAppStatus(status: Stripe.Subscription.Status): AppSubscriptionStatus {
  if (status === "trialing") return "active";
  if (status === "paused") return "canceled";
  const known = KNOWN_APP_STATUSES.find((candidate) => candidate === status);
  // Stripe's type allows for future/unrecognized status strings
  // (OtherString) - default to the least-privileged status rather than risk
  // silently granting access for something we don't understand.
  return known ?? "incomplete";
}

// Isolated in its own "use node" file (per Convex's rule: a file using Node
// built-ins may only export actions, never query/mutation) because Stripe's
// SDK is the only reasonable way to verify a webhook signature (HMAC-SHA256
// over the raw, timestamped payload) - everything else in convex/billing/
// talks to Stripe over plain fetch instead (see stripeClient.ts).
export const processStripeWebhookEvent = internalAction({
  args: { rawBody: v.string(), signature: v.string() },
  handler: async (ctx, args) => {
    const { secretKey, webhookSecret } = requireStripeEnv();
    const stripe = new Stripe(secretKey);
    const event = stripe.webhooks.constructEvent(
      args.rawBody,
      args.signature,
      webhookSecret,
    );

    const isNewEvent = await ctx.runMutation(
      internal.billing.mutations.claimWebhookEvent,
      { stripeEventId: event.id, type: event.type },
    );
    if (!isNewEvent) return;

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customerId =
          typeof session.customer === "string" ? session.customer : null;
        if (userId && customerId) {
          await ctx.runMutation(internal.billing.mutations.upsertCustomerId, {
            userId: userId as Id<"users">,
            stripeCustomerId: customerId,
          });
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : subscription.customer.id;
        const metadataUserId = subscription.metadata?.userId;
        const firstItem = subscription.items.data[0];
        await ctx.runMutation(internal.billing.mutations.applySubscriptionUpdate, {
          ...(metadataUserId ? { userId: metadataUserId as Id<"users"> } : {}),
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          priceId: firstItem?.price.id ?? "",
          status: toAppStatus(subscription.status),
          // Stripe moved billing-period fields onto each subscription item
          // (flexible billing mode) rather than the subscription itself -
          // every subscription here has exactly one item (one price), so
          // that item's period is the subscription's period for our purposes.
          currentPeriodEnd: (firstItem?.current_period_end ?? 0) * 1000,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await ctx.runMutation(internal.billing.mutations.markSubscriptionCanceled, {
          stripeSubscriptionId: subscription.id,
        });
        break;
      }
      case "invoice.payment_failed":
        // No independent write - customer.subscription.updated already
        // carries the resulting "past_due" status. Kept as an explicit case
        // (not falling into default) so it's visible this was considered.
        break;
      default:
        break;
    }
  },
});
