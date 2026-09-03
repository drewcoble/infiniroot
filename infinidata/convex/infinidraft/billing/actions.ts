import { v } from "convex/values";
import { action } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAppBaseUrl } from "../yahoo/client";
import {
  createCheckoutSession,
  createPortalSession,
  retrieveCheckoutSession,
  retrieveSubscription,
} from "./stripeClient";

// Starts a Stripe Checkout session for the current user, reusing their
// existing Stripe customer if this isn't their first time subscribing (so
// cancel-then-resubscribe doesn't fork into duplicate Stripe customers).
// Returns a URL for the frontend to navigate to (window.location.href) -
// Checkout is Stripe's hosted page, so there's no in-app form to build.
export const startCheckout = action({
  args: { successPath: v.string(), cancelPath: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const [subscription, currentUser] = await Promise.all([
      ctx.runQuery(internal.infinidraft.billing.queries.getSubscriptionRow, { userId }),
      ctx.runQuery(api.users.getCurrentUserForDataFetch, {}),
    ]);
    const appBaseUrl = requireAppBaseUrl();
    const session = await createCheckoutSession({
      userId,
      ...(subscription?.stripeCustomerId
        ? { customerId: subscription.stripeCustomerId }
        : currentUser?.email
          ? { customerEmail: currentUser.email }
          : {}),
      successUrl: `${appBaseUrl}${args.successPath}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appBaseUrl}${args.cancelPath}`,
    });
    if (!session.url) {
      throw new Error("Stripe did not return a checkout URL.");
    }
    return { url: session.url };
  },
});

// Opens Stripe's hosted Customer Portal for self-service plan management
// (cancel, update card, view invoices) - only possible once a user has a
// real Stripe customer, i.e. has checked out at least once. Comped-only
// users (no Stripe involvement) have no portal to open; the frontend checks
// for a stripeCustomerId before showing this option (see plan's Phase 5).
export const openBillingPortal = action({
  args: { returnPath: v.string() },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const subscription = await ctx.runQuery(
      internal.infinidraft.billing.queries.getSubscriptionRow,
      { userId },
    );
    if (!subscription?.stripeCustomerId) {
      throw new Error("No billing account found for this user yet.");
    }
    const appBaseUrl = requireAppBaseUrl();
    const session = await createPortalSession({
      customerId: subscription.stripeCustomerId,
      returnUrl: `${appBaseUrl}${args.returnPath}`,
    });
    return { url: session.url };
  },
});

// Called from the Checkout success redirect (see BillingPage) so the UI
// reflects the new subscription immediately instead of waiting for Stripe's
// webhook to arrive - the webhook (convex/infinidraft/billing/webhookHandler.ts) remains
// the authoritative path for everything that happens with no browser tab
// open (renewals, cancellations, retries), this is purely a UX shortcut.
export const reconcileCheckoutSession = action({
  args: { sessionId: v.string() },
  handler: async (ctx, args): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const session = await retrieveCheckoutSession(args.sessionId);
    if (!session.customer || !session.subscription) return;

    await ctx.runMutation(internal.infinidraft.billing.mutations.upsertCustomerId, {
      userId,
      stripeCustomerId: session.customer,
    });

    const subscription = await retrieveSubscription(session.subscription);
    await ctx.runMutation(internal.infinidraft.billing.mutations.applySubscriptionUpdate, {
      userId,
      stripeCustomerId: subscription.customerId,
      stripeSubscriptionId: subscription.id,
      priceId: subscription.priceId,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd * 1000,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    });
  },
});
