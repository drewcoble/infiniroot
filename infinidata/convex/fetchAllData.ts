import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireSuperAdmin, currentSeason } from "./lib/dataFetch";
import { fetchCurrentNflWeek, fetchNflSeasonState } from "./sleeper/state";
import { Scoring, TeScoring, ScoringConfig, scoringConfigFromSeason } from "./scoring";
import { BLENDED_POSITIONS } from "./positions";

// valueGaps.getAllValueGaps is only ever called with the current draft week
// (see src/constants/general.ts's WEEK), so these are the only combos worth
// precomputing daily - see convex/valueGaps.ts's cache comment.
const SCORINGS: Scoring[] = ["STD", "HALF", "PPR"];
const TE_SCORINGS: TeScoring[] = ["NONE", "HALF", "FULL"];

// Full cross-product for valueGaps, the one remaining league-independent
// shared cache - 3 x 3 x 2 = 18 combos. draftValues (including the generic
// league's own row - see convex/genericLeague.ts) stays one combo per real
// draft (that draft's own scoringConfigFromSeason), so its cardinality is
// unaffected by this fan-out.
const ALL_SCORING_CONFIGS: ScoringConfig[] = SCORINGS.flatMap((scoring) =>
  TE_SCORINGS.flatMap((teScoring) =>
    [false, true].map((sixPointPassTds) => ({
      scoring,
      teScoring,
      sixPointPassTds,
    })),
  ),
);

// Shared by fetchAll (after a fresh external fetch) and refreshCaches (an
// on-demand repair with no external calls) - recomputes the valueGaps and
// draftValues caches from whatever projections/rankings/playerSeasonStats
// data already exists in the database.
async function refreshCachedComputations(
  ctx: ActionCtx,
  args: { week: string; season: string },
): Promise<void> {
  const lastSeason = String(Number(args.season) - 1);
  for (const scoringConfig of ALL_SCORING_CONFIGS) {
    await ctx.runMutation(internal.valueGaps.refreshValueGaps, {
      week: args.week,
      scoringConfig,
      lastSeason,
    });
  }

  // Includes the system-owned generic league free users see instead of
  // their own real league's numbers (see convex/genericLeague.ts) - it's a
  // real seasons/drafts row like any other, so listAllSeasons picks it up
  // and refreshes its one (fixed) scoring combo here with no special-casing.
  const seasons = await ctx.runQuery(internal.leagues.listAllSeasons, {});
  for (const season of seasons) {
    const draft = await ctx.runQuery(internal.infinidraft.draft.fetchHelpers.getRealDraftInternal, {
      seasonId: season._id,
    });
    if (!draft) continue;
    await ctx.runMutation(internal.draftValues.refreshDraftValues, {
      draftId: draft._id,
      week: args.week,
      scoringConfig: scoringConfigFromSeason(season),
    });
  }
}

// Runs every working data-fetch: players/projections/rankings/injuries/
// player-points/espn-links/espn-values all come from Sleeper and ESPN (see
// convex/sleeper/ and convex/espn/). Delegates to each source's *Internal
// action variant (not the public, requireSuperAdmin-gated one) - this
// function's own callers (fetchAll below, or fetchAllInternal from the
// cron) already decide once whether a human-auth check applies, so
// re-checking per sub-fetch would be redundant and (for the cron path)
// would break it - see fetchAllInternal.
async function fetchAllHandler(
  ctx: ActionCtx,
  args: { week?: string; season?: string },
): Promise<void> {
  const week = args.week ?? (await fetchCurrentNflWeek());
  const season = args.season ?? currentSeason();

  // Persist Sleeper's live week/season state (see convex/nflState.ts) -
  // independent of the week/season resolved above (which may be a manual
  // backfill override), so in-season tooling always sees the real current
  // week regardless of what this particular fetch was scoped to.
  const nflState = await fetchNflSeasonState();
  await ctx.runMutation(internal.nflState.upsertNflState, {
    season: nflState.season,
    week: String(nflState.week),
    seasonType: nflState.seasonType,
  });

  // Self-healing: idempotent no-op after the first run ever, but makes sure
  // the system-owned generic league (convex/genericLeague.ts) always exists
  // before the draftValues refresh loop below runs - free users depend on
  // it and it should never require a manual setup step to stay present.
  await ctx.runMutation(internal.genericLeague.ensureGenericSeason, {});

  // Sleeper first (players/projections/rankings/injuries, and - for QB/RB/
  // WR/TE - this provider's raw stats into providerProjections rather than
  // straight into projections; see BLENDED_POSITIONS). playerLinks refreshes
  // players.espnId/yahooId from Sleeper's full player directory next, so
  // ESPN's own fetch right after has the freshest id links to match
  // against (new rookies etc. Sleeper only recently backfilled). Then ESPN's
  // rankings+raw-stats fetch, then the blend that turns both providers' raw
  // stats into the actual projections rows every reader uses.
  await ctx.runAction(internal.sleeper.projections.fetchProjectionsInternal, {
    week,
    ...(args.season ? { season: args.season } : {}),
  });
  await ctx.runAction(
    internal.sleeper.playerLinks.fetchSleeperPlayerLinksInternal,
    {},
  );
  await ctx.runAction(internal.espn.rankings.fetchEspnRankingsInternal, {
    season,
    week,
  });
  for (const position of BLENDED_POSITIONS) {
    await ctx.runMutation(internal.projectionBlending.blendProjections, {
      position,
      season,
      week,
    });
  }

  await ctx.runAction(
    internal.sleeper.playerPoints.fetchAllPlayerPointsInternal,
    { ...(args.season ? { year: args.season } : {}) },
  );

  // Refresh the valueGaps/draftValues caches now that the projections/
  // rankings/playerSeasonStats data they're derived from has changed - see
  // convex/valueGaps.ts and convex/draftValues.ts's cache comments.
  await refreshCachedComputations(ctx, { week, season });
}

export const fetchAll = action({
  args: {
    // Omit to auto-detect via Sleeper's state endpoint - this is what the
    // daily cron does (convex/crons.ts), since cron arguments are static at
    // deploy time and can't be recomputed each run. Pass explicitly only
    // for a deliberate manual/backfill fetch.
    week: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    await fetchAllHandler(ctx, args);
  },
});

// Cron-safe counterpart with no human-auth check - a cron-triggered function
// call runs with no signed-in user (ctx.auth.getUserIdentity() is always null
// there), so the requireSuperAdmin-gated fetchAll above can never succeed
// from convex/crons.ts. This is what the daily cron actually calls; the
// public fetchAll stays available for a manual/backfill run from the CLI or
// dashboard.
export const fetchAllInternal = internalAction({
  args: {
    week: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: fetchAllHandler,
});

// Cache-only counterpart to fetchAll - recomputes the valueGaps/draftValues
// caches from whatever projections/rankings/playerSeasonStats data already
// exists, without calling Sleeper. For manually repairing the cache (e.g. it
// was never seeded because the daily cron hasn't run yet) without waiting
// for or forcing a full external refetch.
export const refreshCaches = action({
  args: {
    week: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireSuperAdmin(ctx);

    const week = args.week ?? (await fetchCurrentNflWeek());
    const season = args.season ?? currentSeason();

    await refreshCachedComputations(ctx, { week, season });
  },
});
