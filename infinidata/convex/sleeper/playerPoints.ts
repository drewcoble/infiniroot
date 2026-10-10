import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { POSITIONS } from "../positions";
import {
  currentSeason,
  DEF_TEAM_FPIDS,
  fetchSleeper,
  POSITION_SLUGS,
  requireSuperAdmin,
} from "./client";

type Position = (typeof POSITIONS)[number];

export interface SleeperStatsRecord {
  player_id: string;
  team: string | null;
  stats?: Record<string, number | undefined>;
  player?: { position?: string };
}

const SLEEPER_TO_OUR_POSITION: Record<string, Position> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  K: "K",
};

const WEEKS = Array.from({ length: 18 }, (_, i) => String(i + 1));

export interface ParsedStatsRow {
  fpid: number;
  position: Position;
  ptsStd: number;
  ptsPpr: number;
  ptsHalf: number;
  // Raw box-score categories (pts_*/adp_* stripped) - see playerPoints'
  // schema comment on `stats`.
  stats: Record<string, number>;
}

// One week's Sleeper stats payload -> our fpid/position-keyed rows. Shared
// by the daily playerPoints sync below and the live in-game poll
// (./livePoints.ts) so both read Sleeper's records identically. Doesn't
// filter to known fpids - callers that write per-player rows do that
// themselves (see fetchAllPlayerPointsHandler).
export function parseSleeperStatsRecords(records: SleeperStatsRecord[]): ParsedStatsRow[] {
  const rows: ParsedStatsRow[] = [];
  for (const record of records) {
    const sleeperPosition = record.player?.position;
    if (!sleeperPosition || !(sleeperPosition in SLEEPER_TO_OUR_POSITION)) {
      continue;
    }
    // Guarded by the `in` check above; noUncheckedIndexedAccess still
    // widens the index signature's result to include `undefined`.
    const position: Position = SLEEPER_TO_OUR_POSITION[sleeperPosition]!;
    const fpid =
      position === "DST"
        ? DEF_TEAM_FPIDS[record.team ?? ""]
        : Number(record.player_id);
    if (!fpid) {
      continue;
    }

    // Skip players not currently on an NFL roster - see the matching
    // comment in ./projections.ts for why (free agents dominate Sleeper's
    // payload but are almost never fantasy-relevant).
    if (position !== "DST" && !record.team) {
      continue;
    }

    const stats = record.stats ?? {};
    const numericStats: Record<string, number> = {};
    for (const [key, value] of Object.entries(stats)) {
      if (
        typeof value === "number" &&
        !key.startsWith("pts_") &&
        !key.startsWith("adp_")
      ) {
        numericStats[key] = value;
      }
    }

    rows.push({
      fpid,
      position,
      ptsStd: stats.pts_std ?? 0,
      ptsPpr: stats.pts_ppr ?? 0,
      ptsHalf: stats.pts_half_ppr ?? 0,
      stats: numericStats,
    });
  }
  return rows;
}

/**
 * Actual (not projected) weekly fantasy points, from Sleeper's stats
 * endpoint (the sibling of /projections/... - same shape, category "stat").
 * Unlike projections, there's no season-long bulk mode here, so this loops
 * weeks 1-18, one combined-position call per week. Each call already returns
 * all three scoring formats, so no separate per-scoring fetches are needed
 * (unlike the FantasyPros version this replaces, which needed 3x the calls).
 */
async function fetchAllPlayerPointsHandler(
  ctx: ActionCtx,
  args: { year?: string; weeks?: string[] },
): Promise<Record<string, { inserted: number; updated: number }>> {
  const year = args.year ?? currentSeason();
  const weeks = args.weeks ?? WEEKS;
  const totals: Record<string, { inserted: number; updated: number }> = {};

  // Sleeper's weekly stats payload includes plenty of players we've never
  // stored a `players` row for (e.g. filtered out of projections as
  // free agents - see the matching comment in ./projections.ts). Writing
  // playerPoints for those would create orphan rows with no player to join
  // against, so only keep rows whose fpid we already track.
  const knownFpids = new Set(
    await ctx.runQuery(internal.players.listKnownFpids, {}),
  );

  for (const week of weeks) {
    const records: SleeperStatsRecord[] = await fetchSleeper(
      "stats",
      year,
      week,
      Object.values(POSITION_SLUGS),
    );

    // Games not yet played for this week - expected, not an error.
    if (records.length === 0) {
      continue;
    }

    const rows = parseSleeperStatsRecords(records).filter((row) =>
      knownFpids.has(row.fpid),
    );

    // Chunked rather than one runMutation call for the whole week - each row
    // costs upsertPlayerPoints's own read+write plus (once real games land
    // points > 0) applySeasonStatsDelta's cascade in convex/playerPoints.ts:
    // a season-to-date collect() plus 3 scorings x 6 BONUS_VARIANTS
    // reads+writes. That's ~40 reads per row by late season, so a full
    // week's roster (several hundred rows) in one transaction would be well
    // past Convex's 4096-reads-per-transaction limit (see the matching
    // comment in ../sleeper/playerLinks.ts).
    const CHUNK_SIZE = 50;

    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE).map((row) => ({
        fpid: row.fpid,
        position: row.position,
        week,
        pointsStd: row.ptsStd,
        pointsHalf: row.ptsHalf,
        pointsPpr: row.ptsPpr,
        stats: row.stats,
      }));
      const result = await ctx.runMutation(internal.playerPoints.upsertPlayerPoints, {
        season: year,
        rows: chunk,
      });
      inserted += result.inserted;
      updated += result.updated;
    }
    totals[`week${week}`] = { inserted, updated };
  }

  return totals;
}

export const fetchAllPlayerPoints = action({
  args: {
    year: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return fetchAllPlayerPointsHandler(ctx, args);
  },
});

// Cron-safe counterpart with no human-auth check - see the matching comment
// on fetchProjectionsInternal in convex/sleeper/projections.ts for why this
// is needed. Only fetchAllData.fetchAllInternal calls this.
// `weeks` narrows the fetch (fetchAllData's daily run passes only the
// last few weeks - see recentPointsWeeks there); omitted means all 18.
export const fetchAllPlayerPointsInternal = internalAction({
  args: {
    year: v.optional(v.string()),
    weeks: v.optional(v.array(v.string())),
  },
  handler: fetchAllPlayerPointsHandler,
});
