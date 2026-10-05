import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireSuperAdmin, currentSeason } from "./lib/dataFetch";
import { fetchCurrentNflWeek, fetchNflSeasonState } from "./sleeper/state";
import { ALL_SCORING_CONFIGS, scoringConfigFromSeason } from "./scoring";
import { BLENDED_POSITIONS } from "./positions";

// Prefetches every remaining week's projections, not just the current one,
// so a team page browsing ahead (see infinileague's team page) isn't
// looking at a week the nightly cron never populated - it otherwise only
// ever fetches the single "current" week. Capped at week 18 (WEEK_OPTIONS'
// own bound - see infinileague/src/routes/.../teams/$teamId.tsx) and
// skipped entirely for the "0" season-long sentinel (pre/off-season, or an
// explicit draft-mode backfill), which has no "next week" to speak of.
// Weeks whose actual points the daily run re-fetches: the current week
// plus the two before it, so late games and the NFL's stat corrections
// (typically settled within a week or so) still land, without re-pulling
// and re-checking every completed week of the season every day. Undefined
// (meaning all 18) outside the regular season - fetchCurrentNflWeek's "0" -
// so offseason/post-season runs keep the old full sweep, which is cheap
// there since upsertPlayerPoints skips unchanged rows.
const RECENT_POINTS_WEEKS = 3;
function recentPointsWeeks(week: string): string[] | undefined {
  const weekNum = Number(week);
  if (!Number.isInteger(weekNum) || weekNum <= 0) return undefined;
  const weeks = [];
  for (let w = Math.max(weekNum - RECENT_POINTS_WEEKS + 1, 1); w <= weekNum; w += 1) {
    weeks.push(String(w));
  }
  return weeks;
}

function weeksToFetch(week: string): string[] {
  const weekNum = Number(week);
  if (!Number.isInteger(weekNum) || weekNum <= 0) return [week];

  const weeks = [];
  for (let w = weekNum; w <= 18; w += 1) {
    weeks.push(String(w));
  }
  return weeks;
}

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

  // Rest-of-season projection totals - a second league-independent shared
  // cache alongside valueGaps above, covering every position/scoring combo
  // in one action call (see convex/rosProjTotals.ts for why this has to be
  // an action, not a mutation - summing every remaining week's projections
  // in a single transaction exceeds Convex's per-execution read limit).
  // Must run before the per-season rosVor refresh below, which reads this
  // cache rather than re-summing every remaining week itself.
  await ctx.runAction(internal.rosProjTotals.refreshRosProjTotals, {
    week: args.week,
  });

  // Includes the system-owned generic league free users see instead of
  // their own real league's numbers (see convex/genericLeague.ts) - it's a
  // real seasons/drafts row like any other, so listAllSeasons picks it up
  // and refreshes its one (fixed) scoring combo here with no special-casing.
  const seasons = await ctx.runQuery(internal.leagues.listAllSeasons, {});
  for (const season of seasons) {
    // No draftId dependency (unlike draftValues below) - rosVor only needs
    // the season's own roster/scoring settings, and no-ops on its own if
    // it's not currently an NFL regular season week (see rosVor.ts).
    await ctx.runMutation(internal.rosVor.refreshRosVor, { seasonId: season._id });

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

// Runs every working data-fetch: players/projections/rankings/player-points/
// espn-links/espn-values all come from Sleeper and ESPN (see convex/sleeper/
// and convex/espn/). Injuries are handled by their own, more frequent cron
// (see convex/sleeper/injuries.ts and convex/crons.ts) rather than this one.
// Delegates to each source's *Internal
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
  const liveWeek = nflState.seasonType === "regular" ? String(nflState.week) : "0";

  // Whether this run targets the live week/season (always true for the
  // cron, which passes neither arg). A manual fetch of any other week (the
  // admin panel's week picker) only refreshes that week's own data - the
  // shared caches below (rosProjTotalSets, every league's rosVor,
  // valueGapSets, draftValueSets) all mean "as of the current week", so
  // rebuilding them against a different week would quietly serve wrong
  // rest-of-season numbers until the next daily run.
  const isLiveTarget =
    week === liveWeek && (args.season === undefined || args.season === currentSeason());

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
  //
  // Only `week` itself runs inline here (awaited) - refreshCachedComputations
  // below reads straight from its output, so it has to be done and committed
  // before that call. Every other remaining week of the season (see
  // weeksToFetch) is instead handed to its own scheduled job below, once
  // playerLinks has run - see that loop's own comment for why.
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

  // Every other remaining week of the season, each as its own independently
  // scheduled job (fetchWeekProjectionsInternal below) rather than another
  // turn of an inline loop - a week that far out failing (e.g. Sleeper/ESPN
  // not having published data for some position yet) throws and fails only
  // that one scheduled run, instead of aborting every week after it along
  // with this function's own remaining once-a-day work (playerPoints fetch,
  // refreshCachedComputations). Scheduled rather than awaited, so this
  // function doesn't sit blocked on 17 more weeks' worth of external fetches
  // before it can get to that remaining work either. playerLinks has already
  // run by this point (above), so none of these need to repeat it themselves.
  for (const futureWeek of isLiveTarget ? weeksToFetch(week).slice(1) : []) {
    await ctx.scheduler.runAfter(
      0,
      internal.fetchAllData.fetchWeekProjectionsInternal,
      { week: futureWeek, season },
    );
  }

  // A past-season backfill (args.season set) still sweeps every week -
  // recentPointsWeeks only makes sense relative to the live season.
  const pointsWeeks = args.season ? undefined : recentPointsWeeks(week);
  await ctx.runAction(
    internal.sleeper.playerPoints.fetchAllPlayerPointsInternal,
    {
      ...(args.season ? { year: args.season } : {}),
      ...(pointsWeeks ? { weeks: pointsWeeks } : {}),
    },
  );

  // playerPoints now has every finished week's numbers, so any live
  // in-game document for a week other than the current one is stale -
  // outside the regular season ("0") that's all of them.
  await ctx.runMutation(internal.sleeper.livePoints.pruneLiveWeekPoints, {
    season: nflState.season,
    week: liveWeek,
  });

  // Refresh the valueGaps/draftValues caches now that the projections/
  // rankings/playerSeasonStats data they're derived from has changed - see
  // convex/valueGaps.ts and convex/draftValues.ts's cache comments. Live
  // week only - see isLiveTarget above.
  if (isLiveTarget) {
    await refreshCachedComputations(ctx, { week, season });
  }
}

// One future week's Sleeper fetch -> ESPN fetch -> blend pipeline, run as
// its own scheduled job by fetchAllHandler above (see that function's own
// comment on why) rather than another iteration of an inline loop. No
// playerLinks call here - fetchAllHandler already refreshes it once before
// scheduling any of these, and it isn't week-scoped data to begin with.
export const fetchWeekProjectionsInternal = internalAction({
  args: { week: v.string(), season: v.string() },
  handler: async (ctx, args) => {
    await ctx.runAction(internal.sleeper.projections.fetchProjectionsInternal, {
      week: args.week,
      season: args.season,
    });
    await ctx.runAction(internal.espn.rankings.fetchEspnRankingsInternal, {
      season: args.season,
      week: args.week,
    });
    for (const position of BLENDED_POSITIONS) {
      await ctx.runMutation(internal.projectionBlending.blendProjections, {
        position,
        season: args.season,
        week: args.week,
      });
    }
  },
});

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

// Cache-only counterpart to fetchAll - recomputes the shared caches
// (valueGapSets, rosProjTotalSets, every league's rosVor, draftValueSets)
// from whatever projections/rankings/playerSeasonStats data already
// exists, without fetching anything external beyond Sleeper's week. For
// manually repairing or seeding the caches (e.g. after a cache table
// change, or before the daily cron has run) without a full refetch. Always
// the live week/season - same reason fetchAllHandler's isLiveTarget
// guards these caches.
export const refreshCaches = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    await requireSuperAdmin(ctx);

    const week = await fetchCurrentNflWeek();
    const season = currentSeason();

    await refreshCachedComputations(ctx, { week, season });
  },
});
