// Formats a cached Stripe Price (see convex/billing/pricing.ts) into
// display text like "$9/mo" or "$89.99/yr". unitAmount is Stripe's smallest-
// currency-unit integer (cents for USD), so /100 for whole-currency dollars
// - only correct for 2-decimal currencies, which is all this app uses.
export function formatProPrice(pricing: {
  unitAmount: number;
  currency: string;
  interval: string;
}): string {
  const amount = pricing.unitAmount / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: pricing.currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);

  const intervalLabel =
    pricing.interval === "month"
      ? "mo"
      : pricing.interval === "year"
        ? "yr"
        : pricing.interval;

  return `${formatted}/${intervalLabel}`;
}
