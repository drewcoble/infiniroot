import { Doc, Id } from "../_generated/dataModel";
import { QueryCtx, MutationCtx } from "../_generated/server";

// Statuses that still grant Pro access. "past_due" is included deliberately
// - the app's grace-period policy keeps access live through Stripe's Smart
// Retries, only revoking once Stripe fully cancels the subscription (which
// arrives as a separate "canceled" status via the webhook handler).
const ACCESS_GRANTING_STATUSES = new Set(["active", "past_due"]);

export async function getSubscription(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"subscriptions"> | null> {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

// Comped (super-admin grant) OR an active/retrying Stripe subscription. The
// two are independent booleans, not a shared enum, because a user can be
// both at once (e.g. comped while also separately paying) - see
// convex/schema.ts's subscriptions table comment.
export async function hasProAccess(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const subscription = await getSubscription(ctx, userId);
  if (!subscription) return false;
  return (
    subscription.comped || ACCESS_GRANTING_STATUSES.has(subscription.status)
  );
}

export const FREE_LEAGUES_PER_YEAR = 5;

// Free tier is FREE_LEAGUES_PER_YEAR leagues per calendar year, enforced via
// a permanent grant record per creation (see convex/schema.ts's
// freeLeagueGrants) rather than a live count of leagues.by_owner - a live
// count let a free user delete a completed league and immediately create
// another one, resetting their "free slot" indefinitely. `year` should be
// the same calendar-year string convex/leagues.ts's createLeague uses for
// the new season's `year` field.
export async function countFreeLeagueGrantsForYear(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  year: string,
): Promise<number> {
  const grants = await ctx.db
    .query("freeLeagueGrants")
    .withIndex("by_user_year", (q) => q.eq("userId", userId).eq("year", year))
    .collect();
  return grants.length;
}
