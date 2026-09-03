import { api } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { processEnv } from "./env";

// Shared by every provider's admin-triggered data-fetch action (convex/
// espn/, convex/sleeper/, convex/fetchAllData.ts, convex/projectionBlending.ts)
// - gates the public variant of each fetch action to super-admins only.
export async function requireSuperAdmin(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Please sign in before fetching data.");
  }

  const currentUser = await ctx.runQuery(
    api.users.getCurrentUserForDataFetch,
    {},
  );
  if (currentUser?.role !== "super-admin") {
    throw new Error("Only super-admins can fetch data.");
  }
}

// Default "season" argument for the same admin data-fetch actions above -
// same shared-utility story as requireSuperAdmin. Set NFL_SEASON as a manual
// override (e.g. backfilling a prior season); otherwise falls back to the
// system clock's year.
export function currentSeason() {
  return processEnv?.NFL_SEASON ?? String(new Date().getFullYear());
}
