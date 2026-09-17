import { useMemo } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@infinidata/api";

// Cross-references player rows by fpid to flag rookies - see
// convex/players.ts's getRookieFpids. Returns a Set (not the raw array) so
// callers get an O(1) `.has()` check instead of re-deriving one themselves.
export function useRookieFpids(): Set<number> {
  const { isAuthenticated } = useConvexAuth();
  const fpids = useQuery(api.players.getRookieFpids, isAuthenticated ? {} : "skip");
  return useMemo(() => new Set(fpids ?? []), [fpids]);
}
