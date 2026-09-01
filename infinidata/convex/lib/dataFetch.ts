import { api } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import { processEnv } from "../fantasyPros/client";

// Shared by every provider's admin-triggered data-fetch action (convex/
// espn/, convex/sleeper/, convex/fetchAllData.ts, convex/projectionBlending.ts)
// - gates the public variant of each fetch action to super-admins only.
// Originally lived in convex/fantasyPros/client.ts (this app's first
// provider integration) but outgrew that home once every other provider
// needed the exact same check with nothing FantasyPros-specific about it.
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
// same shared-utility story as requireSuperAdmin.
export function currentSeason() {
  return processEnv?.FANTASYPROS_SEASON ?? String(new Date().getFullYear());
}
