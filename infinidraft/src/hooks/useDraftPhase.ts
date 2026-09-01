import { useQuery } from "convex/react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";

export type DraftPhase = "pre_draft" | "in_progress" | "complete";

export interface DraftPhaseResult {
  phase: DraftPhase;
  // startedAt-derived (see convex/draft/status.ts's syncDraftStatus) -
  // "pre_draft" and "!isStarted" are exactly equivalent, so nothing here
  // needs startedAt itself, just the same draftStatus every route already
  // fetches.
  isStarted: boolean;
  isComplete: boolean;
}

// Single source of truth for "how far along is this league's draft" -
// replaces the two call sites that used to derive this independently
// (src/routes/index.tsx reading server draftStatus directly, and
// AppHeader.tsx re-deriving it client-side via isDraftComplete). Reuses
// api.leagues.listSeasons' draftStatus field rather than a new query, same
// as every existing league route already fetches to resolve `settings`.
export function useDraftPhase(
  seasonId: Id<"seasons"> | undefined,
): DraftPhaseResult | undefined {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const phase = settingsList?.find((s) => s._id === seasonId)?.draftStatus;
  if (!phase) return undefined;
  return {
    phase,
    isStarted: phase !== "pre_draft",
    isComplete: phase === "complete",
  };
}
