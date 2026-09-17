import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

// Whether `userId` may act as this league's owner - either literally is the
// owner, or has been granted the same access via a leagueCollaborators
// invite (convex/infinidraft/sharing/invites.ts's createLeagueInvite/
// redeemLeagueInvite). Exported so requireOwnedSeasonForSync
// (convex/rosterSync.ts) can grant the same access without duplicating the
// leagueCollaborators lookup.
export async function isLeagueAuthorized(
  ctx: QueryCtx | MutationCtx,
  league: Doc<"leagues">,
  userId: Id<"users">,
): Promise<boolean> {
  if (league.ownerId === userId) {
    return true;
  }
  const collaborator = await ctx.db
    .query("leagueCollaborators")
    .withIndex("by_league_user", (q) =>
      q.eq("leagueId", league._id).eq("userId", userId),
    )
    .unique();
  return collaborator !== null;
}

// Confirms the signed-in user owns this season (via its league) OR is an
// invited co-manager (leagueCollaborators) - every convex/infinidraft/
// draft/* and convex/leagues.ts function needs this same check. A
// co-manager is deliberately indistinguishable from the owner here, on
// purpose - the whole point of the sharing feature is "log in and edit
// anything as if you were the owner." Management of sharing itself
// (inviting/revoking/removing) is NOT gated by this - see the stricter
// requireLeagueOwner below.
export async function requireSeasonOwner(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in.");
  }
  const season = await ctx.db.get(seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }
  const league = await ctx.db.get(season.leagueId);
  if (!league) {
    throw new Error("League not found.");
  }
  if (!(await isLeagueAuthorized(ctx, league, userId))) {
    throw new Error("Not authorized to access this season.");
  }
  return { season, league };
}

// Strict owner-only check - unlike requireSeasonOwner above, this never
// admits a leagueCollaborators co-manager. Gates collaborator-management
// itself (convex/infinidraft/sharing/invites.ts's createLeagueInvite/
// revokeLeagueInvite/removeCollaborator) - a co-manager can act as the owner
// everywhere else, but can't grant that same access to someone new; only the
// real owner can.
export async function requireLeagueOwner(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> }> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in.");
  }
  const season = await ctx.db.get(seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }
  const league = await ctx.db.get(season.leagueId);
  if (!league) {
    throw new Error("League not found.");
  }
  if (league.ownerId !== userId) {
    throw new Error("Only the league owner can manage sharing.");
  }
  return { season, league };
}

// Resolves this season's canonical live draft - the "real" (not mock) draft
// every current UI flow (pre-draft, live auction) operates on. Today's app never
// exposes creating a second (mock) draft, so this always exists once the
// season itself does - convex/leagues.ts's createLeague and
// convex/infinidraft/draft/history.ts's createNextSeason both create the real draft
// atomically alongside the season.
export async function requireRealDraft(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<Doc<"drafts">> {
  const draft = await ctx.db
    .query("drafts")
    .withIndex("by_season_kind", (q) =>
      q.eq("seasonId", seasonId).eq("kind", "real"),
    )
    .first();
  if (!draft) {
    throw new Error("No draft found for this season.");
  }
  return draft;
}

// The common case for convex/infinidraft/draft/* functions that operate on live-auction
// state (picks, nominations, budget plan, tags, nomination turns): confirm
// ownership, then resolve this season's one real draft to scope the write/
// read to. Named to match the pre-split helper this replaces.
export async function requireDraftOwner(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{ season: Doc<"seasons">; draft: Doc<"drafts"> }> {
  const { season } = await requireSeasonOwner(ctx, seasonId);
  const draft = await requireRealDraft(ctx, seasonId);
  return { season, draft };
}

// Guards every mutation that edits league configuration locked once the
// draft starts (scoring/roster slots, keeper rules, team count/league
// salary cap, adding/removing teams) - see convex/infinidraft/draft/lifecycle.ts's
// startDraft/reopenPreDraft for the only two mutations that flip startedAt.
export async function requireDraftNotStarted(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{ season: Doc<"seasons">; draft: Doc<"drafts"> }> {
  const result = await requireDraftOwner(ctx, seasonId);
  if (result.draft.startedAt !== undefined) {
    throw new Error(
      "This draft has already started - reopen pre-draft to change league settings.",
    );
  }
  return result;
}

// Guards every mutation that only makes sense once the auction is live
// (nominate, bid, resolve a pick).
export async function requireDraftStarted(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{ season: Doc<"seasons">; draft: Doc<"drafts"> }> {
  const result = await requireDraftOwner(ctx, seasonId);
  if (result.draft.startedAt === undefined) {
    throw new Error("Start the draft before nominating players.");
  }
  return result;
}

// infinifaab's access boundary - deliberately never calls/is called by
// requireSeasonOwner above. A league's commissioner (league.ownerId) can
// act for any team; anyone else needs an explicit leagueTeamMembers row.
// This is what keeps free-agency bidding reachable by an invited team
// owner while every infinidraft/infinileague page (draft board, report
// cards, standings, trade, ...) stays exactly as owner-only as it is today
// - those pages only ever call requireSeasonOwner, never this.
export async function requireSeasonParticipant(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
): Promise<{
  season: Doc<"seasons">;
  league: Doc<"leagues">;
  isCommissioner: boolean;
  // Every team this user is AUTHORIZED to place a bid as - for the
  // commissioner, deliberately every team in the league (they can bid on
  // behalf of a team that hasn't onboarded yet). Use this for authorization
  // (requireTeamAccess below) and for populating a "bidding as" team
  // picker - never for "is this bid mine" display logic, which needs
  // displayTeamIds instead (see its own comment for why conflating the two
  // was a real bug).
  teamIds: Id<"seasonTeams">[];
  // The team(s) that actually represent this real person, for "winning/
  // outbid/mine" display purposes (convex/infinileague/auction/bids.ts's
  // getBidsBoard/getMyBids). For a non-commissioner this is identical to
  // teamIds (their membership rows already name their own team specifically).
  // For the commissioner it's just their own seasonTeams.isSelf team, NOT
  // every team in the league - using the full admin teamIds here made
  // every single active bid read as "winning" for the commissioner, since
  // every team's leadingTeamId was trivially a member of that full set.
  displayTeamIds: Id<"seasonTeams">[];
}> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("You must be signed in.");
  }
  const season = await ctx.db.get(seasonId);
  if (!season) {
    throw new Error("Season not found.");
  }
  const league = await ctx.db.get(season.leagueId);
  if (!league) {
    throw new Error("League not found.");
  }

  if (league.ownerId === userId) {
    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
      .collect();
    const selfTeam = teams.find((t) => t.isSelf);
    return {
      season,
      league,
      isCommissioner: true,
      teamIds: teams.map((t) => t._id),
      displayTeamIds: selfTeam ? [selfTeam._id] : [],
    };
  }

  const memberships = await ctx.db
    .query("leagueTeamMembers")
    .withIndex("by_season_user", (q) =>
      q.eq("seasonId", seasonId).eq("userId", userId),
    )
    .collect();
  if (memberships.length === 0) {
    throw new Error("You don't have access to this league's auction.");
  }
  const memberTeamIds = memberships.map((m) => m.teamId);
  return {
    season,
    league,
    isCommissioner: false,
    teamIds: memberTeamIds,
    displayTeamIds: memberTeamIds,
  };
}

// The common case for a bid/invite-management mutation scoped to one team:
// requireSeasonParticipant, then assert the caller may act for this
// specific team (the commissioner may act for any team in their own
// league; anyone else only for a team they've been added to).
export async function requireTeamAccess(
  ctx: QueryCtx | MutationCtx,
  seasonId: Id<"seasons">,
  teamId: Id<"seasonTeams">,
): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> }> {
  const { season, league, teamIds } = await requireSeasonParticipant(
    ctx,
    seasonId,
  );
  if (!teamIds.includes(teamId)) {
    throw new Error("Not authorized to act for this team.");
  }
  return { season, league };
}
