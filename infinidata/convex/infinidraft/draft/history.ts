import { v } from "convex/values";
import {
  mutation,
  query,
  type QueryCtx,
  type MutationCtx,
} from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireSeasonOwner, requireRealDraft } from "../../lib/access";
import { refreshDraftValuesForLeague } from "../../draftValues";
import { ensureValueGapsCached } from "../../valueGaps";
import { scoringConfigFromSeason } from "../../scoring";

// Mirrors src/constants/general.ts's WEEK - see convex/leagues.ts's copy of
// this same constant for why it's duplicated here rather than imported.
const DRAFT_PREP_WEEK = "0";

// Every season for this league, oldest first (ordered by year - the season's
// own label - with createdAt as a tiebreak for the rare case of two seasons
// sharing a year label). Replaces the old clonedFromId chain walk with a
// plain indexed query over the whole league's history.
export async function getSeasonLineage(
  ctx: QueryCtx | MutationCtx,
  current: Doc<"seasons">,
): Promise<Doc<"seasons">[]> {
  const seasons = await ctx.db
    .query("seasons")
    .withIndex("by_league", (q) => q.eq("leagueId", current.leagueId))
    .collect();
  seasons.sort(
    (a, b) => a.year.localeCompare(b.year) || a.createdAt - b.createdAt,
  );
  return seasons;
}

// The season immediately before `season` in its league's lineage, or
// undefined if `season` is the earliest one on record.
export async function getPreviousSeason(
  ctx: QueryCtx | MutationCtx,
  season: Doc<"seasons">,
): Promise<Doc<"seasons"> | undefined> {
  const lineage = await getSeasonLineage(ctx, season);
  const index = lineage.findIndex((s) => s._id === season._id);
  if (index <= 0) return undefined;
  return lineage[index - 1];
}

export const listSeasonLineage = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    return await getSeasonLineage(ctx, season);
  },
});

// For every player, their price from the most recent PRIOR season in this
// lineage (excluding the current one) - a keeper cost reference. Walks
// ancestors most-recent-first and never overwrites an fpid a more-recent
// season already set. draftPicks.by_draft_fpid already guarantees at most
// one pick per fpid within a single draft (nominate/resolvePick/addKeeper
// all check it), so there's never ambiguity about which pick to use for any
// one season - only across seasons, which the walk order handles.
//
// isKeeper/keeperStreak/fromImmediateParent are carried through so callers
// can compute "if kept again, what would the new streak be" the exact same
// way convex/infinidraft/draft/picks.ts's computeKeeperStreak does server-side (only the
// immediately-prior season counts - a gap season resets to 1) without
// reimplementing that rule separately and risking drift.
export const getPlayerPriceHistory = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { season: current } = await requireSeasonOwner(ctx, args.seasonId);

    const lineage = await getSeasonLineage(ctx, current);
    const currentIndex = lineage.findIndex((s) => s._id === current._id);
    // Most-recent-first, excluding the current season.
    const ancestors = lineage.slice(0, currentIndex).reverse();
    const immediateParentId = ancestors[0]?._id;

    const priceByFpid: Record<
      number,
      {
        // Widened to optional (SNAKE_DRAFT.md §3.2) - undefined for a pick
        // from a non-auction season, where "price" doesn't apply. Callers
        // already need to handle "no prior price" (a player who wasn't
        // drafted/kept last season), so this is the same shape they already
        // guard for.
        price: number | undefined;
        // Round counterpart to price (SNAKE_DRAFT.md §8) - undefined for an
        // auction-season pick (round/pickInRound aren't tracked there).
        round: number | undefined;
        season: string | undefined;
        isKeeper: boolean;
        keeperStreak: number | undefined;
        fromImmediateParent: boolean;
        teamName: string | undefined;
      }
    > = {};
    for (const season of ancestors) {
      const draft = await ctx.db
        .query("drafts")
        .withIndex("by_season_kind", (q) =>
          q.eq("seasonId", season._id).eq("kind", "real"),
        )
        .first();
      if (!draft) continue;
      const picks = await ctx.db
        .query("draftPicks")
        .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
        .collect();
      // Only fetched (and only once per season, not per pick) when at least
      // one pick actually needs a confirmed team name resolved below.
      let teamNameById: Map<string, string> | null = null;
      for (const pick of picks) {
        if (priceByFpid[pick.fpid] !== undefined) continue;
        let teamName: string | undefined;
        if (pick.teamAssignmentConfirmed) {
          if (!teamNameById) {
            const teams = await ctx.db
              .query("seasonTeams")
              .withIndex("by_season", (q) => q.eq("seasonId", season._id))
              .collect();
            teamNameById = new Map(teams.map((t) => [t._id, t.name]));
          }
          teamName = teamNameById.get(pick.teamId);
        }
        priceByFpid[pick.fpid] = {
          price: pick.price,
          round: pick.round,
          season: season.year,
          isKeeper: pick.isKeeper ?? false,
          keeperStreak: pick.keeperStreak,
          fromImmediateParent: season._id === immediateParentId,
          teamName,
        };
      }
    }
    return priceByFpid;
  },
});

// Starts a new season for this league: inserts a new seasons row (copying
// durable config - roster shape, scoring, cap, keeper rule definitions with
// tier membership reset) plus that season's one real draft, then copies
// teams and the pre-draft budget plan forward - but not draftPicks/
// draftNominations/draftPlayerTags, which are live-draft state specific to
// how one auction actually played out. Throws if this league already has a
// season for the target year, so a double-click/retry can't silently create
// two seasons with the same label.
export const createNextSeason = mutation({
  args: {
    id: v.id("seasons"),
    season: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const { season: source, league } = await requireSeasonOwner(ctx, args.id);

    const existingYear = await ctx.db
      .query("seasons")
      .withIndex("by_league_year", (q) =>
        q.eq("leagueId", league._id).eq("year", args.season),
      )
      .first();
    if (existingYear) {
      throw new Error(`This league already has a season for ${args.season}.`);
    }

    const now = Date.now();
    if (league.name !== args.name) {
      await ctx.db.patch(league._id, { name: args.name });
    }

    const newSeasonId = await ctx.db.insert("seasons", {
      leagueId: league._id,
      year: args.season,
      teamCount: source.teamCount,
      salaryCap: source.salaryCap,
      scoring: source.scoring,
      rosterSlots: source.rosterSlots,
      flexPositions: source.flexPositions,
      superflexPositions: source.superflexPositions,
      createdAt: now,
      ...(source.teScoring !== undefined
        ? { teScoring: source.teScoring }
        : {}),
      ...(source.sixPointPassTds !== undefined
        ? { sixPointPassTds: source.sixPointPassTds }
        : {}),
      // Carries forward same as every other durable config field here -
      // format doesn't change season-to-season (SNAKE_DRAFT.md §3.4's
      // assumption). convex/leagues.ts's setDraftType can correct a wrong
      // initial pick, but only pre-draft with zero picks recorded - a new
      // season here always starts with picks-so-far at zero, so it stays
      // eligible for that same correction window right after creation, not
      // meaningfully more "changeable" than any other league.
      ...(source.draftType !== undefined
        ? { draftType: source.draftType }
        : {}),
      ...(source.useKeepers !== undefined
        ? { useKeepers: source.useKeepers }
        : {}),
      // Formula/tier definitions carry forward as durable league config, but
      // each tier's designated players are picked fresh every season - see
      // schema.ts's comment on seasons.keeperRules.
      ...(source.keeperRules
        ? {
            keeperRules: {
              ...source.keeperRules,
              tiers: source.keeperRules.tiers.map((tier) => ({
                ...tier,
                fpids: [],
              })),
            },
          }
        : {}),
    });

    const newDraftId = await ctx.db.insert("drafts", {
      seasonId: newSeasonId,
      kind: "real",
      name: args.name,
      status: "pre_draft",
      createdAt: now,
    });

    const sourceDraft = await requireRealDraft(ctx, args.id);

    const sourceTeams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", args.id))
      .collect();
    for (const team of sourceTeams) {
      await ctx.db.insert("seasonTeams", {
        seasonId: newSeasonId,
        name: team.name,
        isSelf: team.isSelf,
        order: team.order,
        createdAt: now,
        ...(team.salaryCapOverride !== undefined
          ? { salaryCapOverride: team.salaryCapOverride }
          : {}),
      });
    }

    const sourcePlan = await ctx.db
      .query("draftBudgetPlans")
      .withIndex("by_draft", (q) => q.eq("draftId", sourceDraft._id))
      .first();
    if (sourcePlan) {
      await ctx.db.insert("draftBudgetPlans", {
        draftId: newDraftId,
        amounts: sourcePlan.amounts,
        overspendBehavior: sourcePlan.overspendBehavior,
        updatedAt: now,
      });
    }

    // Seed the new season's draftValues cache immediately (same reasoning as
    // convex/leagues.ts's createLeague) rather than leaving it empty until
    // the next daily cron run. Unlike createLeague, this season's year is
    // known exactly (args.season), so lastSeason doesn't need the
    // current-year fallback.
    await refreshDraftValuesForLeague(ctx, {
      draftId: newDraftId,
      week: DRAFT_PREP_WEEK,
      scoringConfig: scoringConfigFromSeason(source),
    });
    await ensureValueGapsCached(ctx, {
      week: DRAFT_PREP_WEEK,
      scoringConfig: scoringConfigFromSeason(source),
      lastSeason: String(Number(args.season) - 1),
    });

    return newSeasonId;
  },
});
