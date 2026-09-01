import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { DraftType } from "../draftType";

// Shared insert logic behind both apps' initializeSeasonTeams mutations
// (convex/infinidraft/draft/teams.ts, convex/infinileague/season/teams.ts) -
// called directly (not via ctx.runMutation) so leagues.ts's createLeague can
// also seed a plain custom league's default "Team N" rows in the same
// transaction as the league/season/draft it just created, with no separate
// round trip. Creates the owner's own team (isSelf: true, order 0) plus one
// row per opponent name, and seeds the nomination order to this same entry
// order (linear mode) so a league always has an *active* suggested order
// from the moment teams exist, rather than sitting "manual" until someone
// visits TeamsPanel and clicks Save - "manual" now only happens if a host
// intentionally clears it (see clearNominationOrder).
export async function insertSeasonTeams(
  ctx: MutationCtx,
  args: {
    seasonId: Id<"seasons">;
    draftId: Id<"drafts">;
    // Determines whether draftOrder gets seeded below - callers pass this
    // in rather than insertSeasonTeams re-fetching season/draft docs, since
    // every current caller already has what resolveDraftType needs on hand.
    draftType: DraftType;
    selfName: string;
    opponentNames: string[];
    selfSleeperLink?:
      { sleeperRosterId: string; sleeperOwnerId: string } | undefined;
    opponentSleeperLinks?:
      | ({ sleeperRosterId: string; sleeperOwnerId: string } | null)[]
      | undefined;
    selfYahooTeamKey?: string | undefined;
    opponentYahooTeamKeys?: (string | null)[] | undefined;
  },
): Promise<Id<"seasonTeams">> {
  const now = Date.now();
  const selfId = await ctx.db.insert("seasonTeams", {
    seasonId: args.seasonId,
    name: args.selfName,
    isSelf: true,
    order: 0,
    createdAt: now,
    ...(args.selfSleeperLink ?? {}),
    ...(args.selfYahooTeamKey ? { yahooTeamKey: args.selfYahooTeamKey } : {}),
  });
  const teamIds = [selfId];
  for (const [index, name] of args.opponentNames.entries()) {
    const link = args.opponentSleeperLinks?.[index];
    const yahooTeamKey = args.opponentYahooTeamKeys?.[index];
    teamIds.push(
      await ctx.db.insert("seasonTeams", {
        seasonId: args.seasonId,
        name,
        isSelf: false,
        order: index + 1,
        createdAt: now,
        ...(link ?? {}),
        ...(yahooTeamKey ? { yahooTeamKey } : {}),
      }),
    );
  }

  // nominationOrder is set unconditionally - it's meaningless outside a
  // live auction (see schema.ts), so leaving it populated for snake/linear
  // is harmless. draftOrder is the opposite: several convex/infinidraft/
  // draft/pickSlots.ts mutations (tradePickSlot, forfeitPickSlot,
  // restorePickSlot) rely on it being *unset* for auction leagues as their
  // only guard against running there, so it must stay gated on draftType
  // rather than also being unconditional. For snake/linear, draftOrder is a
  // hard precondition rather than a soft suggestion - convex/infinidraft/
  // draft/picks.ts's draftPick throws "Set the draft order before picking"
  // without it - so leaving it unset there would make a freshly created
  // snake/linear league undraftable until a host visited TeamsPanel and
  // saved an order by hand.
  const isAuction = args.draftType === "auction";
  await ctx.db.patch(args.draftId, {
    nominationOrder: teamIds,
    nominationOrderMode: "linear",
    ...(isAuction ? {} : { draftOrder: teamIds }),
  });
  await ctx.db.insert("draftNominationTurns", {
    draftId: args.draftId,
    currentTeamId: selfId,
    direction: 1,
    updatedAt: now,
  });

  return selfId;
}
