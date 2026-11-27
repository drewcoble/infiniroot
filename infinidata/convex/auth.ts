import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      // Email addresses are case-insensitive in practice (every mainstream
      // provider treats them that way), but this provider's own account
      // lookup (authAccounts.providerAndAccountId) is a case-sensitive
      // exact match on the raw email string - without this, "User@x.com"
      // and "user@x.com" sign up as two separate accounts, and signing in
      // with a different case than you signed up with just fails to match.
      // `profile` runs for every flow (signUp/signIn/reset/etc - see this
      // provider's own JSDoc), so this is the one place that normalizes
      // both directions. Only signUp writes the profile to `users`, so the
      // name the sign-up form sends is stored then (trimmed, capped) - what
      // commissioners see for each member (convex/infiniyoffs/members.ts).
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const name = String(params.name ?? "").trim().slice(0, 40);
        const profile: { email: string; name?: string } = { email };
        if (params.flow === "signUp" && name && name !== email) profile.name = name;
        return profile as { email: string };
      },
    }),
  ],
});
