import { v } from "convex/values";
import { query } from "../../_generated/server";
import { positionValidator } from "../../positions";
import { computeFaabSuggestions, type FaabSuggestionsResult } from "../../lib/faab";

// Thin wrapper over the shared computation (convex/lib/faab.ts) - see
// convex/infinidraft/season/faabValues.ts for infinidraft's identical
// wrapper. Kept as two separate queries (rather than one shared query) so a
// change to one app's FAAB tooling can never accidentally affect the other.
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
