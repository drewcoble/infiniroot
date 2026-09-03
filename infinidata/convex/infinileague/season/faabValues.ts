import { v } from "convex/values";
import { query } from "../../_generated/server";
import { positionValidator } from "../../positions";
import { computeFaabSuggestions, type FaabSuggestionsResult } from "../../lib/faab";

// Thin wrapper over the shared computation (convex/lib/faab.ts) - backs
// infinileague's Free Agents tab (src/routes/league/$leagueId/freeAgents.tsx).
// Previously mirrored by an identical convex/infinidraft/season/faabValues.ts
// wrapper backing infinidraft's own Free Agents tab; that UI moved here and
// the infinidraft wrapper was deleted, since infinidraft no longer surfaces
// FAAB tooling at all.
export const getFaabSuggestions = query({
  args: {
    seasonId: v.id("seasons"),
    teamId: v.optional(v.id("seasonTeams")),
    position: v.optional(positionValidator),
  },
  handler: async (ctx, args): Promise<FaabSuggestionsResult> => {
    return await computeFaabSuggestions(ctx, args);
  },
});
