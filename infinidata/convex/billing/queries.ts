import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  countFreeLeagueGrantsForYear,
  FREE_LEAGUES_PER_YEAR,
  getSubscription,
  hasProAccess,
} from "./entitlements";

// Frontend pre-check used to show upgrade CTAs before a user hits a
// gated action (e.g. disabling "+ New League" instead of letting the
// createLeague mutation throw) - a UX nicety, not the enforcement boundary.
// The real checks live server-side in convex/leagues.ts's createLeague and
// convex/draft/reportCard.ts's getDraftReportCardPublic. Also surfaces
// freeLeaguesUsed/freeLeagueLimit so the delete-league warning
// (LeagueDetails.tsx) can show a free-tier user's standing.
export const getMyEntitlement = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        hasProAccess: false,
        canCreateFreeLeague: true,
        freeLeaguesUsed: 0,
        freeLeagueLimit: FREE_LEAGUES_PER_YEAR,
      };
    }
    const thisYear = String(new Date().getFullYear());
    const [proAccess, freeLeaguesUsed] = await Promise.all([
      hasProAccess(ctx, userId),
      countFreeLeagueGrantsForYear(ctx, userId, thisYear),
    ]);
    return {
      hasProAccess: proAccess,
      canCreateFreeLeague: freeLeaguesUsed < FREE_LEAGUES_PER_YEAR,
      freeLeaguesUsed,
      freeLeagueLimit: FREE_LEAGUES_PER_YEAR,
    };
  },
});

// Used by convex/billing/actions.ts (an action, which can't touch ctx.db
// directly) to look up an existing Stripe customer id before starting
// checkout / opening the billing portal.
export const getSubscriptionRow = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => await getSubscription(ctx, args.userId),
});

// Super-admin-only lookup for the comp-access admin panel (src/pages/Admin/
// AdminBillingPanel.tsx) - finds a user by their exact profile email (same
// by_email index convex/users.ts's getCurrentUserDoc already relies on) and
// returns just enough billing state to show/edit their comp status.
export const findUserForComp = query({
  args: { email: v.string() },
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
      throw new Error("Only super-admins can look up users.");
    }

    // userProfiles.email is stored lowercased (see convex/auth.ts's Password
    // profile callback), so the lookup needs the same normalization or a
    // differently-cased search misses a real match.
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) =>
        q.eq("email", args.email.trim().toLowerCase()),
      )
      .unique();
    if (!profile?.userId) return null;

    const subscription = await getSubscription(ctx, profile.userId);
    return {
      userId: profile.userId,
      email: profile.email,
      name: profile.name,
      comped: subscription?.comped ?? false,
      status: subscription?.status ?? "none",
    };
  },
});

// Full billing status for the current user's own Billing page (src/pages/
// Billing/BillingPage.tsx) - unlike getMyEntitlement, this exposes enough
// detail (status, renewal date, comped flag, whether a real Stripe customer
// exists) to render "you're on Pro until X" / "manage subscription" copy.
export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const subscription = await getSubscription(ctx, userId);
    if (!subscription) return null;
    return {
      status: subscription.status,
      comped: subscription.comped,
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
      hasStripeCustomer: !!subscription.stripeCustomerId,
    };
  },
});
