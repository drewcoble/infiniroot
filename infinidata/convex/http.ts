import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { exchangeYahooCode, requireAppBaseUrl } from "./infinidraft/yahoo/client";

const http = httpRouter();

auth.addHttpRoutes(http);

function yahooRedirectTarget(
  appBaseUrl: string,
  seasonId: string | undefined,
): string {
  return seasonId
    ? `${appBaseUrl}/season/${seasonId}/settings`
    : `${appBaseUrl}/`;
}

// Yahoo redirects the bare browser here after the user approves (or denies)
// access on Yahoo's own consent screen - see convex/infinidraft/yahoo/oauth.ts's
// startYahooAuth (which generates the `state` this route validates) and
// YAHOO.md at the project root for the redirect-URI registration this
// depends on. Not authenticated by necessity (a top-level browser navigation
// carries no Convex auth session) - the one-time `state` row is what maps
// this request back to a specific app user instead.
http.route({
  path: "/yahoo/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const appBaseUrl = requireAppBaseUrl();

    if (!code || !state) {
      return Response.redirect(
        `${appBaseUrl}/?yahooError=${encodeURIComponent("Missing code or state from Yahoo.")}`,
        302,
      );
    }

    const stateRow = await ctx.runMutation(
      internal.infinidraft.yahoo.oauth.consumeOAuthState,
      { state },
    );
    if (!stateRow) {
      return Response.redirect(
        `${appBaseUrl}/?yahooError=${encodeURIComponent("This Yahoo connection attempt expired - try again.")}`,
        302,
      );
    }

    const target = yahooRedirectTarget(appBaseUrl, stateRow.seasonId);
    try {
      const tokens = await exchangeYahooCode(code);
      await ctx.runMutation(internal.infinidraft.yahoo.oauth.saveTokens, {
        userId: stateRow.userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      return Response.redirect(
        `${target}?yahooError=${encodeURIComponent(message)}`,
        302,
      );
    }

    return Response.redirect(`${target}?yahooConnected=1`, 302);
  }),
});

// Stripe's server-to-server notification of subscription lifecycle events
// (see convex/infinidraft/billing/webhookHandler.ts) - necessarily unauthenticated (no
// Convex session), so the Stripe-Signature header + STRIPE_WEBHOOK_SECRET is
// what proves this request actually came from Stripe. Reads the raw body via
// request.text() - the signature is computed over those exact bytes, so it
// must be read once, before any JSON parsing, exactly like this.
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing Stripe-Signature header", { status: 400 });
    }
    const rawBody = await request.text();
    try {
      await ctx.runAction(internal.infinidraft.billing.webhookHandler.processStripeWebhookEvent, {
        rawBody,
        signature,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      return new Response(`Webhook error: ${message}`, { status: 400 });
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
