import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@infinidata/api";

// Most player rows on screen come from projections/draftValues/faabValues,
// none of which carry yearsExp - this is the one place that does, so
// RookieBadge call sites cross-reference by fpid instead of threading
// yearsExp through every one of those pipelines (and their draftValues/
// genericDraftValues caches).
export function useRookieFpids(): Set<number> {
  const fpids = useQuery(api.players.getRookieFpids);
  return useMemo(() => new Set(fpids ?? []), [fpids]);
}
