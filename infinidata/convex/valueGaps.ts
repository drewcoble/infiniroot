import { v } from "convex/values";
import {
  query,
  internalMutation,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { POSITIONS } from "./positions";
import {
  scoringConfigValidator,
  pointsForScoringConfig,
  adpForScoring,
  ScoringConfig,
} from "./scoring";

type Position = (typeof POSITIONS)[number];

// DST never gets a real ADP at all, and K's relevance is already filtered
// by points rather than ADP elsewhere (see src/lib/relevantPlayers.ts) -
// neither fits the "ADP vs track record" comparison this signal is built
// on. QB/RB/WR/TE only, per validated analysis.
const VALUE_GAP_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

// Mirrors src/lib/relevantPlayers.ts's RELEVANT_ADP_CEILING (see
// convex/infinidraft/draft/tiers.ts for why convex/ duplicates rather than imports it -
// convex/ never depends on src/). A real rank ceiling rather than Sleeper's
// own "no real ADP" 999 sentinel - top 350 overall is roughly the depth of
// even a large/deep redraft league; 999 lets through a long tail of
// technically-non-999-but-still-noise ADP values.
const RELEVANT_ADP_CEILING = 350;

// Below this many recorded weeks, last season's points-per-game is too
// small a sample (injury-shortened season, late call-up) to trust as a
// track record.
const MIN_GAMES = 6;

// A player must rank in the top ~40% on BOTH last year's PPG and this
// year's projection independently before a low ADP counts as "underpriced" -
// averaging the two let one great score mask a mediocre other during
// validation, which is why this is a gate rather than just an input to the
// average. BAD_PCTL_THRESHOLD is the mirror image for "overvalued": bottom
// ~40% on both, symmetric around the same 50th-percentile midpoint.
const GOOD_PCTL_THRESHOLD = 60;
const BAD_PCTL_THRESHOLD = 100 - GOOD_PCTL_THRESHOLD;

// A merely-positive gap isn't enough to flag on its own - a rank-1-vs-
// rank-2 difference within a ~60-70 player pool is only ~1.5 percentile
// points and is noise, not a real ADP mispricing (e.g. WR1 by both last
// year's PPG and this year's projection, but WR2 by ADP, shouldn't read as
// "undervalued"). Require the gap to clear a real margin before it counts.
const MIN_GAP_PCTL = 10;

// "breakout" gates on three independent conditions (bad last year AND good
// projection AND good ADP) instead of two, which makes it structurally
// stricter than undervalued/overvalued at the same threshold - validated
// against real data, 60/40 + a 10pt gap surfaced only 3 players
// league-wide. Loosened on its own (not shared with GOOD/BAD/MIN_GAP_PCTL
// above, so undervalued/overvalued are unaffected) to widen the pool.
const BREAKOUT_GOOD_PCTL_THRESHOLD = 55;
const BREAKOUT_BAD_PCTL_THRESHOLD = 100 - BREAKOUT_GOOD_PCTL_THRESHOLD;
const BREAKOUT_MIN_GAP_PCTL = 6;

// "falloff" is NOT breakout's mirror image - an earlier version gated on
// bad ADP too (good last year, bad projection, bad ADP), but that only
// catches declines the market has already priced in, which isn't
// actionable in a draft. Gating on GOOD adp instead (last year was good,
// this year's projection has soured, but ADP hasn't caught down yet) finds
// the market-lag case instead - closer in spirit to undervalued/overvalued
// than to breakout. gap is adpPctl - projPctl (how far ADP lags the
// projection's more pessimistic view) rather than a last-year comparison.
// Thresholds tuned separately from breakout's - validated against real
// data, 52/48 + a 5pt gap landed a 5-player league-wide list that read
// clean (Mahomes, Stafford, RJ Harvey, Michael Wilson, Dallas Goedert).
const FALLOFF_GOOD_PCTL_THRESHOLD = 52;
const FALLOFF_BAD_PCTL_THRESHOLD = 100 - FALLOFF_GOOD_PCTL_THRESHOLD;
const FALLOFF_MIN_GAP_PCTL = 5;

export interface ValueGapRow {
  fpid: number;
  position: Position;
  direction: "undervalued" | "overvalued" | "breakout" | "falloff";
  gap: number;
  lastYearPpg: number;
  lastYearGames: number;
  lastYearRank: number;
  projRank: number;
  adpRank: number;
  poolSize: number;
}

// rank=1 (best) -> 100, rank=n (worst) -> 0.
function percentile(rank: number, n: number): number {
  if (n <= 1) return 100;
  return ((n - rank) / (n - 1)) * 100;
}

// ESPN's own draft-kit rank (see convex/espn/rankings.ts / standardValues
// table) is a second, independently-sourced market consensus alongside
// Sleeper ADP - two sources agreeing is a stronger signal than either alone,
// so this is blended into the ADP percentile below rather than left as the
// separate "vs. market" $ diff shown in src/components/StandardValueLabel.tsx
// (that one compares this app's own $ value against ESPN's; this is about
// ESPN's rank corroborating or contradicting Sleeper's ADP rank).
// Mirrors src/lib/standardValues.ts's buildStandardValueByFpid (HALF
// scoring averages standard+ppr, ESPN has no half-PPR format of its own) but
// reads ctx.db directly since that helper works off an already-fetched
// query result, not a QueryCtx/MutationCtx. Not superflex-aware -
// getAllValueGaps takes no superflex flag (its ADP input isn't superflex-
// aware either), so this always reads ESPN's standard/ppr pools.
async function buildEspnRankByFpid(
  ctx: QueryCtx | MutationCtx,
  season: string,
  scoring: ScoringConfig["scoring"],
): Promise<Map<number, number>> {
  const formats: Array<"standard" | "ppr"> =
    scoring === "PPR"
      ? ["ppr"]
      : scoring === "STD"
        ? ["standard"]
        : ["standard", "ppr"];

  const rowsByFormat = await Promise.all(
    formats.map((format) =>
      ctx.db
        .query("standardValues")
        .withIndex("by_platform_format_season_fpid", (q) =>
          q.eq("platform", "espn").eq("format", format).eq("season", season),
        )
        .collect(),
    ),
  );

  if (formats.length === 1) {
    return new Map(rowsByFormat[0]!.map((row) => [row.fpid, row.rank]));
  }

  const standardByFpid = new Map(rowsByFormat[0]!.map((row) => [row.fpid, row.rank]));
  const pprByFpid = new Map(rowsByFormat[1]!.map((row) => [row.fpid, row.rank]));
  const merged = new Map<number, number>();
  for (const fpid of new Set([...standardByFpid.keys(), ...pprByFpid.keys()])) {
    const a = standardByFpid.get(fpid);
    const b = pprByFpid.get(fpid);
    merged.set(fpid, a !== undefined && b !== undefined ? (a + b) / 2 : (a ?? b)!);
  }
  return merged;
}

/**
 * Flags four kinds of track-record/current-season mismatches:
 * - "undervalued": genuinely good last season (by points-per-game, not
 *   total - total rewards games played over quality) AND still projected
 *   well this season, but current ADP doesn't reflect either.
 * - "overvalued": the mirror image - genuinely bad on both axes, but ADP
 *   still rates them better than that deserves.
 * - "breakout": genuinely bad last season by PPG, but this season's outlook
 *   (projection AND ADP, averaged the same way "deserved" is above) is
 *   good on both - a bounce-back/emergence case rather than an ADP
 *   mispricing.
 * - "falloff": genuinely good last season by PPG AND this season's
 *   projection has soured on them, but ADP is still good - the market
 *   hasn't caught down to the projected decline yet. Deliberately NOT
 *   breakout's mirror image (that would require ADP to also be bad, which
 *   only catches declines the market already knows about) - this is a real
 *   mispricing (sell-high) signal instead, closer in spirit to
 *   undervalued/overvalued than to breakout.
 *
 * breakout/falloff require the same MIN_GAMES-qualified prior-season track
 * record as undervalued/overvalued, so a true rookie with zero games last
 * season can never qualify for either.
 *
 * Every direction requires the gap to actually point the flagged way
 * (deserved/outlook percentile vs the comparison percentile) - passing the
 * gate alone isn't enough, since a player can pass the gate AND already be
 * correctly priced/projected, which isn't a mismatch worth flagging. The
 * gap must also clear a minimum margin, not just be positive - a top player
 * whose ADP is one spot off their deserved rank isn't a real mispricing,
 * just noise at the tight top of the pool.
 *
 * Everything is percentile-ranked within the SAME population: this year's
 * ADP-relevant players who also have a qualifying prior-season track
 * record. Comparing last season's PPG against a wider "everyone with 6+
 * games" pool while comparing projection/ADP against only the ADP-relevant
 * pool was tried and produced garbage - deep-bench scrubs looked
 * artificially good by comparison to that wider, weaker population.
 */
// Does the actual 3-collects-per-position computation - factored out so both
// the cache-miss fallback below and refreshValueGaps's daily precompute
// share one implementation. QueryCtx | MutationCtx since this only ever
// reads (ctx.db.query/.get), never writes.
async function computeValueGaps(
  ctx: QueryCtx | MutationCtx,
  args: { week: string; scoringConfig: ScoringConfig; lastSeason: string },
): Promise<ValueGapRow[]> {
  const output: ValueGapRow[] = [];

  // Same season this method's own lastSeason+1 resolves to everywhere else
  // (see convex/fetchAllData.ts's refreshCachedComputations) - computeValueGaps
  // takes lastSeason rather than the current season directly, so this is
  // re-derived rather than adding a new arg every caller would need to thread
  // through.
  const currentSeason = String(Number(args.lastSeason) + 1);
  const espnRankByFpid = await buildEspnRankByFpid(
    ctx,
    currentSeason,
    args.scoringConfig.scoring,
  );

  for (const position of VALUE_GAP_POSITIONS) {
    const projections = await ctx.db
      .query("projections")
      .withIndex("by_position_week", (q) =>
        q.eq("position", position).eq("week", args.week),
      )
      .collect();

    const rankings = await ctx.db
      .query("rankings")
      .withIndex("by_position_week", (q) =>
        q.eq("position", position).eq("week", args.week),
      )
      .collect();
    const adpByFpid = new Map(rankings.map((r) => [r.fpid, r]));

    const relevant = projections.filter((row) => {
      const adpRow = adpByFpid.get(row.fpid);
      const adp = adpRow
        ? adpForScoring(adpRow, args.scoringConfig.scoring)
        : undefined;
      return adp !== undefined && adp < RELEVANT_ADP_CEILING;
    });

    // One row per fpid instead of scanning all 18 weeks - the week-by-week
    // scan across 4 positions was measured (via `npx convex insights`)
    // exceeding the 32k-documents-per-transaction limit. playerSeasonStats
    // is maintained incrementally by upsertPlayerPoints (see
    // convex/playerPoints.ts), including the same "0-point week doesn't
    // count as a game" rule this file used to apply inline, and keyed by the
    // full ScoringConfig (not just base scoring) so lastYearPpg below is
    // bonus-aware in TE-premium/6pt-passing leagues too.
    const seasonStats = await ctx.db
      .query("playerSeasonStats")
      .withIndex("by_position_season_scoring_teScoring_sixPointPassTds", (q) =>
        q
          .eq("position", position)
          .eq("season", args.lastSeason)
          .eq("scoring", args.scoringConfig.scoring)
          .eq("teScoring", args.scoringConfig.teScoring)
          .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds),
      )
      .collect();
    const pointsByFpid = new Map(
      seasonStats.map((row) => [row.fpid, row.totalPoints]),
    );
    const gamesByFpid = new Map(
      seasonStats.map((row) => [row.fpid, row.gamesPlayed]),
    );

    // Eligible = this year's ADP-relevant AND a qualifying prior-season
    // track record - ranking below happens within this exact population.
    const eligible = relevant
      .filter((row) => (gamesByFpid.get(row.fpid) ?? 0) >= MIN_GAMES)
      .map((row) => ({
        fpid: row.fpid,
        points: pointsForScoringConfig(row, args.scoringConfig),
        adp: adpForScoring(adpByFpid.get(row.fpid)!, args.scoringConfig.scoring),
        ppg: pointsByFpid.get(row.fpid)! / gamesByFpid.get(row.fpid)!,
        games: gamesByFpid.get(row.fpid)!,
      }));

    const n = eligible.length;
    if (n === 0) continue;

    const rankOf = (sorted: typeof eligible) =>
      new Map(sorted.map((e, i) => [e.fpid, i + 1]));
    const ppgRank = rankOf([...eligible].sort((a, b) => b.ppg - a.ppg));
    const projRank = rankOf([...eligible].sort((a, b) => b.points - a.points));
    const adpRank = rankOf([...eligible].sort((a, b) => a.adp - b.adp));
    // Only ranked among eligible players ESPN actually covers - percentile-
    // ranking against a pool including players ESPN doesn't rank would make
    // "has no rank" indistinguishable from "ranked dead last".
    const withEspnRank = eligible.filter((e) => espnRankByFpid.has(e.fpid));
    const espnRank = rankOf(
      [...withEspnRank].sort(
        (a, b) => espnRankByFpid.get(a.fpid)! - espnRankByFpid.get(b.fpid)!,
      ),
    );

    for (const e of eligible) {
      const ppgPctl = percentile(ppgRank.get(e.fpid)!, n);
      const projPctl = percentile(projRank.get(e.fpid)!, n);
      const adpPctl = percentile(adpRank.get(e.fpid)!, n);
      // Blends Sleeper ADP with ESPN's own draft-kit rank when ESPN covers
      // this player (see buildEspnRankByFpid above) - two independently-
      // sourced market consensuses agreeing is a stronger "market" signal
      // than ADP alone, so this (not raw adpPctl) drives every gate/gap
      // below. Falls back to ADP-only when ESPN has no rank for this player
      // (e.g. its draft kit doesn't reach this deep, or this season's ESPN
      // fetch hasn't landed yet), which reproduces the pre-blend behavior
      // exactly - never worse than ADP alone, only ever more informed.
      const espnRankForFpid = espnRank.get(e.fpid);
      const marketPctl =
        espnRankForFpid !== undefined
          ? (adpPctl + percentile(espnRankForFpid, withEspnRank.length)) / 2
          : adpPctl;
      const deserved = (ppgPctl + projPctl) / 2;
      const thisYearOutlook = (projPctl + marketPctl) / 2;

      let direction:
        "undervalued" | "overvalued" | "breakout" | "falloff" | undefined;
      let gap = 0;
      if (ppgPctl >= GOOD_PCTL_THRESHOLD && projPctl >= GOOD_PCTL_THRESHOLD) {
        gap = deserved - marketPctl;
        if (gap > MIN_GAP_PCTL) direction = "undervalued";
      } else if (
        ppgPctl <= BAD_PCTL_THRESHOLD &&
        projPctl <= BAD_PCTL_THRESHOLD
      ) {
        gap = marketPctl - deserved;
        if (gap > MIN_GAP_PCTL) direction = "overvalued";
      } else if (
        ppgPctl <= BREAKOUT_BAD_PCTL_THRESHOLD &&
        projPctl >= BREAKOUT_GOOD_PCTL_THRESHOLD &&
        marketPctl >= BREAKOUT_GOOD_PCTL_THRESHOLD
      ) {
        gap = thisYearOutlook - ppgPctl;
        if (gap > BREAKOUT_MIN_GAP_PCTL) direction = "breakout";
      } else if (
        ppgPctl >= FALLOFF_GOOD_PCTL_THRESHOLD &&
        projPctl <= FALLOFF_BAD_PCTL_THRESHOLD &&
        marketPctl >= FALLOFF_GOOD_PCTL_THRESHOLD
      ) {
        gap = marketPctl - projPctl;
        if (gap > FALLOFF_MIN_GAP_PCTL) direction = "falloff";
      }
      if (!direction) continue;

      output.push({
        fpid: e.fpid,
        position,
        direction,
        gap,
        lastYearPpg: e.ppg,
        lastYearGames: e.games,
        lastYearRank: ppgRank.get(e.fpid)!,
        projRank: projRank.get(e.fpid)!,
        adpRank: adpRank.get(e.fpid)!,
        poolSize: n,
      });
    }
  }

  return output;
}

export const getAllValueGaps = query({
  args: {
    week: v.string(),
    scoringConfig: scoringConfigValidator,
    lastSeason: v.string(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("valueGaps")
      .withIndex("by_week_scoring_teScoring_sixPointPassTds_lastSeason", (q) =>
        q
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring)
          .eq("teScoring", args.scoringConfig.teScoring)
          .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds)
          .eq("lastSeason", args.lastSeason),
      )
      .collect();
    if (cached.length > 0) {
      return cached.map((row): ValueGapRow => ({
        fpid: row.fpid,
        position: row.position,
        direction: row.direction,
        gap: row.gap,
        lastYearPpg: row.lastYearPpg,
        lastYearGames: row.lastYearGames,
        lastYearRank: row.lastYearRank,
        projRank: row.projRank,
        adpRank: row.adpRank,
        poolSize: row.poolSize,
      }));
    }

    // Cache miss (the daily refresh hasn't covered this exact combo yet) -
    // fall back to the live computation so the result is still correct.
    return computeValueGaps(ctx, args);
  },
});

// Recomputes getAllValueGaps for one (week, scoring, lastSeason) combo and
// replaces its cached rows - called from fetchAllData once a day, after the
// projections/rankings/playerSeasonStats data it reads has been refreshed.
// Also called directly (not via the mutation wrapper below) by
// ensureValueGapsCached, so a brand-new league's scoring format gets seeded
// immediately at creation time rather than waiting on the daily cron.
export async function refreshValueGapsForCombo(
  ctx: MutationCtx,
  args: { week: string; scoringConfig: ScoringConfig; lastSeason: string },
) {
  const rows = await computeValueGaps(ctx, args);

  const existing = await ctx.db
    .query("valueGaps")
    .withIndex("by_week_scoring_teScoring_sixPointPassTds_lastSeason", (q) =>
      q
        .eq("week", args.week)
        .eq("scoring", args.scoringConfig.scoring)
        .eq("teScoring", args.scoringConfig.teScoring)
        .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds)
        .eq("lastSeason", args.lastSeason),
    )
    .collect();
  for (const row of existing) await ctx.db.delete(row._id);

  for (const row of rows) {
    await ctx.db.insert("valueGaps", {
      ...row,
      week: args.week,
      lastSeason: args.lastSeason,
      ...args.scoringConfig,
    });
  }
}

export const refreshValueGaps = internalMutation({
  args: {
    week: v.string(),
    scoringConfig: scoringConfigValidator,
    lastSeason: v.string(),
  },
  handler: async (ctx, args) => {
    await refreshValueGapsForCombo(ctx, args);
  },
});

// Seeds the valueGaps cache for one combo only if it's missing - valueGaps is
// shared across every league at the same scoring format (unlike draftValues,
// which is per-league), so a second league created with a scoring format an
// existing league already seeded shouldn't pay to recompute it again.
export async function ensureValueGapsCached(
  ctx: MutationCtx,
  args: { week: string; scoringConfig: ScoringConfig; lastSeason: string },
) {
  const cached = await ctx.db
    .query("valueGaps")
    .withIndex("by_week_scoring_teScoring_sixPointPassTds_lastSeason", (q) =>
      q
        .eq("week", args.week)
        .eq("scoring", args.scoringConfig.scoring)
        .eq("teScoring", args.scoringConfig.teScoring)
        .eq("sixPointPassTds", args.scoringConfig.sixPointPassTds)
        .eq("lastSeason", args.lastSeason),
    )
    .first();
  if (cached) return;
  await refreshValueGapsForCombo(ctx, args);
}

// One-off migration helper: wipes every valueGaps row so it can be reseeded
// with the new required teScoring/sixPointPassTds fields (added when TE
// Premium/6pt passing TDs shipped) - existing rows predate those fields and
// would fail schema validation otherwise. Same wipe-and-rebuild precedent as
// convex/playerPoints.ts's clearSeasonStats. Safe to run any time after
// that: getAllValueGaps' cache-miss fallback (computeValueGaps) keeps every
// read correct while the cache is empty, and refreshCaches (or the next
// daily cron) reseeds it.
export const clearValueGaps = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("valueGaps")
      .paginate({ cursor: args.cursor ?? null, numItems: 500 });

    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.valueGaps.clearValueGaps, {
        cursor: result.continueCursor,
      });
    }
  },
});
