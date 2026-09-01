import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Doc, Id } from "./_generated/dataModel";
import { MutationCtx, QueryCtx } from "./_generated/server";

const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;

function normalizeEmail(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function getAllowedSuperAdminEmails(overrideEmails?: string[] | null) {
  const fromEnv = [
    processEnv?.SUPER_ADMIN_EMAILS,
    processEnv?.VITE_SUPER_ADMIN_EMAILS,
    processEnv?.CONVEX_SUPER_ADMIN_EMAILS,
  ]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) =>
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    );

  const fromOverride = (overrideEmails ?? [])
    .map((item) => normalizeEmail(item))
    .filter(Boolean);

  return [...new Set([...fromEnv, ...fromOverride])];
}

function getRoleForIdentity(
  email: string | null | undefined,
  existingRole: string | null | undefined,
  overrideEmails?: string[] | null,
) {
  const normalizedEmail = normalizeEmail(email);
  const allowedEmails = getAllowedSuperAdminEmails(overrideEmails);

  if (allowedEmails.includes(normalizedEmail)) {
    return "super-admin" as const;
  }

  return existingRole === "super-admin"
    ? ("super-admin" as const)
    : ("user" as const);
}

// The users table (from authTables) is the source of truth for email/name.
// The JWT identity itself carries no email/name claims (no jwt.customClaims
// configured in convex/auth.ts), so identity.email/identity.name are never
// populated - always read profile fields off the users row instead.
async function getAuthUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return await ctx.db.get(userId);
}

// identity.tokenIdentifier embeds a session id that rotates on every sign-in
// (@convex-dev/auth JWT `sub` is `${userId}|${sessionId}`), so it cannot key
// long-lived profile data. userId (from getAuthUserId) is the stable anchor;
// the tokenIdentifier/email lookups below are legacy fallbacks for profiles
// created before userId was tracked, and self-heal via the patch in callers.
async function getCurrentUserDoc(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  tokenIdentifier: string,
  email?: string | null,
) {
  const byUserId = await ctx.db
    .query("userProfiles")
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .unique();

  if (byUserId) {
    return byUserId;
  }

  const byTokenIdentifier = await ctx.db
    .query("userProfiles")
    .withIndex("by_token_identifier", (q) =>
      q.eq("tokenIdentifier", tokenIdentifier),
    )
    .first();

  if (byTokenIdentifier) {
    return byTokenIdentifier;
  }

  if (email) {
    const byEmail = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
      .first();

    if (byEmail) {
      return byEmail;
    }
  }

  return null;
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const authUser = await getAuthUser(ctx, userId);
    return await getCurrentUserDoc(
      ctx,
      userId,
      identity.tokenIdentifier,
      authUser?.email ?? null,
    );
  },
});

export const ensureCurrentUser = mutation({
  args: {
    allowlistedEmails: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("You must be signed in.");
    }

    const authUser = await getAuthUser(ctx, userId);
    const email = authUser?.email ?? null;
    const name = authUser?.name ?? email ?? "User";

    const existing = await getCurrentUserDoc(
      ctx,
      userId,
      identity.tokenIdentifier,
      email,
    );
    const role = getRoleForIdentity(
      email,
      existing?.role ?? null,
      args.allowlistedEmails,
    );

    if (existing) {
      const needsUpdate =
        existing.userId !== userId ||
        existing.tokenIdentifier !== identity.tokenIdentifier ||
        existing.name !== name ||
        existing.email !== email ||
        existing.role !== role;

      if (needsUpdate) {
        await ctx.db.patch(existing._id, {
          userId,
          tokenIdentifier: identity.tokenIdentifier,
          name,
          email,
          role,
        });
      }

      return await ctx.db.get(existing._id);
    }

    const newUserId = await ctx.db.insert("userProfiles", {
      userId,
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role,
      createdAt: Date.now(),
    });

    return await ctx.db.get(newUserId);
  },
});

export const getCurrentUserForDataFetch = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const authUser = await getAuthUser(ctx, userId);
    return await getCurrentUserDoc(
      ctx,
      userId,
      identity.tokenIdentifier,
      authUser?.email ?? null,
    );
  },
});

export const promoteCurrentUserToSuperAdmin = mutation({
  args: {
    allowlistedEmails: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("You must be signed in.");
    }

    const authUser = await getAuthUser(ctx, userId);
    const email = authUser?.email ?? null;
    const currentUser = await getCurrentUserDoc(
      ctx,
      userId,
      identity.tokenIdentifier,
      email,
    );
    const normalizedEmail = normalizeEmail(email ?? currentUser?.email);
    const allowedEmails = getAllowedSuperAdminEmails(args.allowlistedEmails);

    if (
      currentUser?.role !== "super-admin" &&
      !allowedEmails.includes(normalizedEmail)
    ) {
      throw new Error(
        "Your email is not allowlisted as a super-admin. Add it to VITE_SUPER_ADMIN_EMAILS in .env.local (or SUPER_ADMIN_EMAILS in the Convex environment) and restart the app.",
      );
    }

    if (!currentUser) {
      const newUserId = await ctx.db.insert("userProfiles", {
        userId,
        tokenIdentifier: identity.tokenIdentifier,
        name: authUser?.name ?? email ?? "User",
        email,
        role: "super-admin",
        createdAt: Date.now(),
      });
      return await ctx.db.get(newUserId);
    }

    await ctx.db.patch(currentUser._id, {
      userId,
      tokenIdentifier: identity.tokenIdentifier,
      email: email ?? currentUser.email,
      name: authUser?.name ?? email ?? currentUser.name,
      role: "super-admin",
    });

    return await ctx.db.get(currentUser._id);
  },
});

// One-off backfill for accounts created before convex/auth.ts's Password
// `profile` callback started lowercasing email on sign-up/sign-in - without
// this, an account that originally signed up with mixed-case letters (e.g.
// "User@Example.com") would stop matching its own lookups the moment that
// normalization shipped, since every sign-in attempt now normalizes the
// input before searching. Fixes all three places email is stored
// (authAccounts.providerAccountId, users.email, userProfiles.email) so
// login keeps working under the new case-insensitive behavior. Idempotent -
// safe to run again, it just no-ops on anything already lowercase. Run via
// `npx convex run users:normalizeExistingEmailCasing`.
export const normalizeExistingEmailCasing = internalMutation({
  args: {},
  handler: async (ctx) => {
    let patched = 0;

    for (const account of await ctx.db.query("authAccounts").collect()) {
      if (
        account.provider === "password" &&
        account.providerAccountId !== account.providerAccountId.toLowerCase()
      ) {
        await ctx.db.patch(account._id, {
          providerAccountId: account.providerAccountId.toLowerCase(),
        });
        patched++;
      }
    }

    for (const user of await ctx.db.query("users").collect()) {
      if (user.email && user.email !== user.email.toLowerCase()) {
        await ctx.db.patch(user._id, { email: user.email.toLowerCase() });
        patched++;
      }
    }

    for (const profile of await ctx.db.query("userProfiles").collect()) {
      if (profile.email && profile.email !== profile.email.toLowerCase()) {
        await ctx.db.patch(profile._id, {
          email: profile.email.toLowerCase(),
        });
        patched++;
      }
    }

    return { patched };
  },
});
