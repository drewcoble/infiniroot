import { getAuthUserId } from "@convex-dev/auth/server";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

// Confirms the signed-in user owns this season (via its league) - every
// convex/infinidraft/draft/* and convex/leagues.ts function needs this same check.
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
  if (league.ownerId !== userId) {
    throw new Error("Not authorized to access this season.");
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
