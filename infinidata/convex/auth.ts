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
      // both directions. Mirrors defaultProfile's shape (email only - name
      // is deliberately never stored on `users` here, see convex/users.ts's
      // ensureCurrentUser, which falls back to email itself).
      profile(params) {
        return { email: String(params.email ?? "").trim().toLowerCase() };
      },
    }),
  ],
});
