import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  ActionCtx,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { buildYahooAuthorizeUrl, refreshYahooTokens } from "./client";

// A stored state row older than this is treated as invalid (abandoned OAuth
// attempt, or someone replaying a stale URL) - consumeOAuthState deletes it
// either way rather than letting it accumulate.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Refresh proactively this far ahead of expiresAt rather than waiting for a
// 401 mid-request - Yahoo access tokens are short-lived (~1hr).
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const requireSignedInUserId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    return userId;
  },
});

export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    userId: v.id("users"),
    seasonId: v.optional(v.id("seasons")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("yahooOAuthState", { ...args, createdAt: Date.now() });
  },
});

// Looks up and deletes a state row - one-time use, whether or not it turns
// out valid. Returns null for a missing or stale row so the HTTP callback
// (convex/http.ts) can redirect to an error state instead of throwing.
export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: Id<"users">; seasonId: Id<"seasons"> | undefined } | null> => {
    const row = await ctx.db
      .query("yahooOAuthState")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (Date.now() - row.createdAt > STATE_MAX_AGE_MS) return null;
    return { userId: row.userId, seasonId: row.seasonId };
  },
});

export const getStoredToken = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("yahooOAuthTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const saveTokens = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("yahooOAuthTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const updatedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt });
    } else {
      await ctx.db.insert("yahooOAuthTokens", { ...args, updatedAt });
    }
  },
});

// Whether the signed-in user has a connected Yahoo account - drives the
// Season Settings UI's "Connect Yahoo Account" vs. league-picker state.
export const getConnectionStatus = query({
  args: {},
  handler: async (ctx): Promise<{ connected: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { connected: false };
    const token = await ctx.db
      .query("yahooOAuthTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return { connected: !!token };
  },
});

// Kicks off the OAuth round trip - generates a one-time state, stashes it
// (and optionally which league's Settings page to return to), and returns
// the Yahoo authorize URL for the frontend to redirect the browser to.
export const startYahooAuth = action({
  args: { seasonId: v.optional(v.id("seasons")) },
  handler: async (ctx, args): Promise<{ authorizeUrl: string }> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.infinidraft.yahoo.oauth.requireSignedInUserId,
      {},
    );
    const state = crypto.randomUUID();
    await ctx.runMutation(internal.infinidraft.yahoo.oauth.createOAuthState, {
      state,
      userId,
      ...(args.seasonId ? { seasonId: args.seasonId } : {}),
    });
    return { authorizeUrl: buildYahooAuthorizeUrl(state) };
  },
});

// Loads this user's stored Yahoo token, refreshing it first if it's within
// REFRESH_MARGIN_MS of expiring, then calls `fn` with a valid access token.
// Every Yahoo API call in convex/infinidraft/yahoo/league.ts goes through this so token
// expiry is handled in exactly one place.
export async function withYahooToken<T>(
  ctx: ActionCtx,
  userId: Id<"users">,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  const stored = await ctx.runQuery(internal.infinidraft.yahoo.oauth.getStoredToken, {
    userId,
  });
  if (!stored) {
    throw new Error(
      "Yahoo account not connected - connect it from Season Settings first.",
    );
  }

  let accessToken = stored.accessToken;
  if (stored.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    const refreshed = await refreshYahooTokens(stored.refreshToken);
    accessToken = refreshed.access_token;
    await ctx.runMutation(internal.infinidraft.yahoo.oauth.saveTokens, {
      userId,
      accessToken: refreshed.access_token,
      // Yahoo may not always return a fresh refresh_token on refresh -
      // fall back to the one already on file when it doesn't.
      refreshToken: refreshed.refresh_token || stored.refreshToken,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
    });
  }

  return await fn(accessToken);
}
