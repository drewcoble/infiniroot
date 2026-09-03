// Generic env accessor shared by every provider client (Sleeper/ESPN/Yahoo/
// Gemini/Stripe/Resend) and convex/lib/dataFetch.ts - originally lived in
// convex/fantasyPros/client.ts (this app's first provider integration) but
// outgrew that home once every other provider needed the same accessor with
// nothing FantasyPros-specific about it.
export const processEnv = (
  globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }
).process?.env;
