import { internalMutation, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { POSITIONS } from "./positions";
import type { RosterSlotCounts } from "./draft/slots";

type Position = (typeof POSITIONS)[number];

// The one fixed league shape + scoring format free-tier users' draft values
// are computed from - mirrors src/constants/leagueSettings.ts's DEFAULT_FORM
// (12 teams, $200 cap, standard roster, PPR/no TE premium/4pt passing TDs)
// exactly, so "generic" means the same thing here as it does anywhere else
// in the app that shows a sensible out-of-the-box default. Duplicated here
// rather than imported since Convex functions can't import from src/ - same
// reasoning as DRAFT_PREP_WEEK in convex/leagues.ts duplicating a frontend
// constant.
export const GENERIC_LEAGUE_SETTINGS = {
  teamCount: 12,
  salaryCap: 200,
  scoring: "PPR" as const,
  teScoring: "NONE" as const,
  sixPointPassTds: false,
  rosterSlots: {
    QB: 1,
    RB: 2,
    WR: 2,
    TE: 1,
    DST: 1,
    K: 0,
    FLEX: 1,
    SUPERFLEX: 0,
    BENCH: 8,
  } satisfies RosterSlotCounts,
  flexPositions: ["RB", "WR", "TE"] as Position[],
  superflexPositions: ["QB", "RB", "WR", "TE"] as Position[],
};

// Idempotent: creates the one system-owned league/season/real-draft that
// serves every free-tier user the exact same draftValues (see convex/
// draftValues.ts's getDraftValues and schema.ts's genericLeagueConfig) the
// first time this runs, then just returns the existing seasonId on every
// later call. The owner is a placeholder users row (every field there is
// optional, so an empty insert is valid) rather than any real signed-in
// account - that's what keeps this league from ever showing up in anyone's
// own "my leagues" list (which is always scoped to the caller's own userId).
export const ensureGenericSeason = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx): Promise<Id<"seasons">> => {
    const existing = await ctx.db.query("genericLeagueConfig").first();
    if (existing) return existing.seasonId;

    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {});
    const leagueId = await ctx.db.insert("leagues", {
      ownerId,
      name: "Generic (free tier)",
      createdAt: now,
    });
    const seasonId = await ctx.db.insert("seasons", {
      leagueId,
      year: new Date().getFullYear().toString(),
      teamCount: GENERIC_LEAGUE_SETTINGS.teamCount,
      salaryCap: GENERIC_LEAGUE_SETTINGS.salaryCap,
      scoring: GENERIC_LEAGUE_SETTINGS.scoring,
      teScoring: GENERIC_LEAGUE_SETTINGS.teScoring,
      sixPointPassTds: GENERIC_LEAGUE_SETTINGS.sixPointPassTds,
      rosterSlots: GENERIC_LEAGUE_SETTINGS.rosterSlots,
      flexPositions: GENERIC_LEAGUE_SETTINGS.flexPositions,
      superflexPositions: GENERIC_LEAGUE_SETTINGS.superflexPositions,
      createdAt: now,
    });
    await ctx.db.insert("drafts", {
      seasonId,
      kind: "real",
      name: "Generic",
      status: "pre_draft",
      createdAt: now,
    });
    await ctx.db.insert("genericLeagueConfig", { seasonId });

    return seasonId;
  },
});
