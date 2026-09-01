import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@infinidata/api";

// Reads the cached Stripe Price for the Pro plan (see convex/billing/
// pricing.ts) and kicks off a background fetch the first time it's missing
// - same "read cache, trigger a mutation to backfill it" pattern
// DraftReportCard.tsx uses for the AI recap. Returns undefined while
// loading, null if Stripe isn't configured in this deployment at all.
export function useProPricing() {
  const pricing = useQuery(api.billing.pricing.getProPricing);
  const ensureCached = useMutation(api.billing.pricing.ensureProPricingCached);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (pricing === null && !requestedRef.current) {
      requestedRef.current = true;
      void ensureCached();
    }
  }, [pricing, ensureCached]);

  return pricing;
}
