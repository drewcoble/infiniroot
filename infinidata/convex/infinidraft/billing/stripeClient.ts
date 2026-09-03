import { processEnv } from "../../lib/env";

/**
 * Stripe REST API (https://docs.stripe.com/api). Plain fetch, matching this
 * codebase's other third-party clients (convex/infinidraft/yahoo/client.ts)
 * rather than pulling in the full Stripe SDK for basic REST calls - the
 * `stripe` npm package is used elsewhere (see
 * convex/infinidraft/billing/webhookHandler.ts) only for webhook signature verification,
 * which is genuinely hard to hand-roll safely.
 */
const API_BASE_URL = "https://api.stripe.com/v1";

export function requireStripeEnv() {
  const secretKey = processEnv?.STRIPE_SECRET_KEY?.trim();
  const priceId = processEnv?.STRIPE_PRO_PRICE_ID?.trim();
  const webhookSecret = processEnv?.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !priceId || !webhookSecret) {
    throw new Error(
      "STRIPE_SECRET_KEY / STRIPE_PRO_PRICE_ID / STRIPE_WEBHOOK_SECRET are " +
        "not fully set - see STRIPE.md at the project root for setup steps.",
    );
  }
  return { secretKey, priceId, webhookSecret };
}

async function stripeRequest<T>(
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const { secretKey } = requireStripeEnv();
  const url = new URL(`${API_BASE_URL}${path}`);
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (params && method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  } else if (params) {
    init.body = new URLSearchParams(params).toString();
  }

  const response = await fetch(url.toString(), init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Stripe request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
  customer: string | null;
}

export async function createCheckoutSession(params: {
  userId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<StripeCheckoutSession> {
  const { priceId } = requireStripeEnv();
  const body: Record<string, string> = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.userId,
    "subscription_data[metadata][userId]": params.userId,
  };
  if (params.customerId) {
    body.customer = params.customerId;
  } else if (params.customerEmail) {
    body.customer_email = params.customerEmail;
  }
  return await stripeRequest<StripeCheckoutSession>(
    "POST",
    "/checkout/sessions",
    body,
  );
}

export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<StripeCheckoutSession & { subscription: string | null }> {
  return await stripeRequest(
    "GET",
    `/checkout/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function createPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<{ url: string }> {
  return await stripeRequest("POST", "/billing_portal/sessions", {
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

interface StripePriceResponse {
  id: string;
  currency: string;
  unit_amount: number | null;
  recurring: { interval: string } | null;
}

export interface RetrievedPrice {
  priceId: string;
  unitAmount: number;
  currency: string;
  interval: string;
}

// Used only to display the Pro plan's price (see convex/infinidraft/billing/pricing.ts)
// - never to determine what Checkout actually charges, which is entirely up
// to Stripe/the price object itself once createCheckoutSession references
// STRIPE_PRO_PRICE_ID.
export async function retrievePrice(priceId: string): Promise<RetrievedPrice> {
  const price = await stripeRequest<StripePriceResponse>(
    "GET",
    `/prices/${encodeURIComponent(priceId)}`,
  );
  return {
    priceId: price.id,
    unitAmount: price.unit_amount ?? 0,
    currency: price.currency,
    interval: price.recurring?.interval ?? "month",
  };
}

interface StripeSubscriptionResponse {
  id: string;
  customer: string;
  status: string;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{ price: { id: string }; current_period_end: number }>;
  };
}

export interface RetrievedSubscription {
  id: string;
  customerId: string;
  priceId: string;
  // Our subscriptions.status union (convex/schema.ts) omits Stripe's
  // "trialing" (no trial - see plan) and "paused" - map both to a status our
  // access check treats sensibly rather than passing an unrecognized string
  // through to a v.union validator, which would throw.
  status:
    | "none"
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid";
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

const KNOWN_STATUSES = new Set([
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
]);

export async function retrieveSubscription(
  subscriptionId: string,
): Promise<RetrievedSubscription> {
  const subscription = await stripeRequest<StripeSubscriptionResponse>(
    "GET",
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  );
  const firstItem = subscription.items.data[0];
  let status: RetrievedSubscription["status"] = "incomplete";
  if (subscription.status === "trialing") status = "active";
  else if (subscription.status === "paused") status = "canceled";
  else if (KNOWN_STATUSES.has(subscription.status)) {
    status = subscription.status as RetrievedSubscription["status"];
  }
  return {
    id: subscription.id,
    customerId: subscription.customer,
    priceId: firstItem?.price.id ?? "",
    status,
    currentPeriodEnd: firstItem?.current_period_end ?? 0,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}
