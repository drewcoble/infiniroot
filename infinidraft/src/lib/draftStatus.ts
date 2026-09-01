// Mirrors convex/leagues.ts's listSeasons SeasonWithLeagueName.draftStatus
// field exactly - shared between the dashboard's league cards
// (routes/index.tsx) and the league picker's per-item badge
// (AppHeader.tsx) so the two can't drift apart.
export type DraftStatus = "pre_draft" | "in_progress" | "complete";

export const DRAFT_STATUS_META: Record<
  DraftStatus,
  { label: string; color: string }
> = {
  pre_draft: { label: "Pre-Draft", color: "gray" },
  in_progress: { label: "Drafting", color: "saddlebrown.8" },
  complete: { label: "Post-Draft", color: "green.8" },
};
