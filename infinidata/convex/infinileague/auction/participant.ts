import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireSeasonParticipant } from "../../lib/access";

export interface MyParticipation {
  isCommissioner: boolean;
  teams: Array<{ teamId: Id<"seasonTeams">; name: string }>;
}

// "Who am I in this season" - drives which team(s) a user can pick from
// when placing a bid (Players tab), and whether Settings' edit controls
// show at all (only the commissioner can call updateAuctionSettings/
// createTeamInvite/etc - this just lets the frontend hide them rather than
// showing controls that would throw on submit).
export const getMyParticipation = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<MyParticipation> => {
    const { isCommissioner, teamIds } = await requireSeasonParticipant(
      ctx,
      args.seasonId,
    );
    const teamDocs = await Promise.all(teamIds.map((id) => ctx.db.get(id)));
    const teams = teamDocs
      .filter((t): t is Doc<"seasonTeams"> => t !== null)
      .map((t) => ({ teamId: t._id, name: t.name }));
    return { isCommissioner, teams };
  },
});
