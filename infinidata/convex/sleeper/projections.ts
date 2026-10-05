import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { POSITIONS, BLENDED_POSITIONS } from "../positions";
import {
  currentSeason,
  DEF_TEAM_FPIDS,
  fetchSleeper,
  POSITION_SLUGS,
  requireSuperAdmin,
  SleeperProjectionRecord,
} from "./client";

type Position = (typeof POSITIONS)[number];

const SLEEPER_TO_OUR_POSITION: Record<string, Position> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  K: "K",
};

type FetchProjectionsResult = Record<
  Position,
  {
    players: { inserted: number; updated: number };
    projections: { upserted: number; removed: number };
    rankings: { upserted: number; removed: number };
  }
>;

async function fetchProjectionsHandler(
  ctx: ActionCtx,
  args: { week: string; season?: string },
): Promise<FetchProjectionsResult> {
  const season = args.season ?? currentSeason();
  // The app's "0" (season-long) sentinel maps to omitting the week path
  // segment entirely - that's Sleeper's season-long projections mode.
  const apiWeek = args.week === "0" ? undefined : args.week;

  const records: SleeperProjectionRecord[] = await fetchSleeper(
    "projections",
    season,
    apiWeek,
    Object.values(POSITION_SLUGS),
  );

  // The combined position[] filter lets a handful of secondary-position
  // players leak through (e.g. FB tagged RB-eligible) - enforce an exact
  // match against the positions we actually asked for.
  const bySleeperPosition = new Map<string, SleeperProjectionRecord[]>();
  for (const record of records) {
    const sleeperPosition = record.player?.position;
    if (!sleeperPosition || !(sleeperPosition in SLEEPER_TO_OUR_POSITION)) {
      continue;
    }
    const list = bySleeperPosition.get(sleeperPosition) ?? [];
    list.push(record);
    bySleeperPosition.set(sleeperPosition, list);
  }

  const results: Partial<
    Record<
      Position,
      {
        players: { inserted: number; updated: number };
        projections: { upserted: number; removed: number };
        rankings: { upserted: number; removed: number };
      }
    >
  > = {};

  for (const position of POSITIONS) {
    const sleeperSlug = POSITION_SLUGS[position];
    const positionRecords = bySleeperPosition.get(sleeperSlug) ?? [];

    if (positionRecords.length === 0) {
      throw new Error(
        `Sleeper API returned no players for ${position} (season=${season}, week=${args.week}).`,
      );
    }

    const playerRows = [];
    const projectionRows = [];
    const rankingRows = [];

    for (const record of positionRecords) {
      const fpid =
        position === "DST"
          ? DEF_TEAM_FPIDS[record.team ?? ""]
          : Number(record.player_id);

      if (!fpid) {
        // No known synthetic id for this team abbreviation - skip rather
        // than store a bogus fpid of 0/NaN.
        continue;
      }

      // Players not currently on an NFL roster (free agents/practice squad
      // cuts) make up the bulk of Sleeper's per-position payload but are
      // almost never fantasy-relevant - skip them so they never hit the
      // players/projections/rankings tables. DST records use `team` as their
      // own identity (the fpid lookup above already requires it), so this
      // only affects individual players.
      if (position !== "DST" && !record.team) {
        continue;
      }

      const name =
        `${record.player?.first_name ?? ""} ${record.player?.last_name ?? ""}`.trim();
      const team = record.team ?? null;
      // Sleeper's season-long payload (unlike per-week) sometimes sends this
      // as an explicit null rather than omitting it - the players table's
      // yearsExp column only accepts a number or being left out entirely.
      const yearsExp =
        typeof record.player?.years_exp === "number"
          ? record.player.years_exp
          : undefined;
      const stats = { ...(record.stats ?? {}) };

      const pointsStd = stats.pts_std ?? 0;
      const pointsPpr = stats.pts_ppr ?? 0;
      const pointsHalf = stats.pts_half_ppr ?? 0;
      const adpStd = stats.adp_std ?? 999;
      const adpPpr = stats.adp_ppr ?? 999;
      const adpHalf = stats.adp_half_ppr ?? 999;

      const numericStats: Record<string, number> = {};
      for (const [key, value] of Object.entries(stats)) {
        if (
          typeof value === "number" &&
          !key.startsWith("pts_") &&
          !key.startsWith("adp_") &&
          // bonus_rec_wr/rb/te just mirror "rec" (PPR reception-bonus
          // scoring inputs, not a distinct stat) - confirmed against live
          // data the values are identical, so drop rather than show a
          // duplicate "Bonus Rec X" column next to "Receptions".
          !key.startsWith("bonus_rec_") &&
          // idp_* (individual-defense stats: tackles, IDP int, ...) show up
          // on the rare two-way player Sleeper tracks defensive stats for
          // too (e.g. Travis Hunter) - this league doesn't score IDP, and
          // one player's columns would otherwise sit empty for everyone else.
          !key.startsWith("idp_")
        ) {
          numericStats[key] = value;
        }
      }

      playerRows.push({
        fpid,
        name,
        position,
        team,
        ...(yearsExp !== undefined ? { yearsExp } : {}),
      });
      projectionRows.push({
        fpid,
        name,
        team,
        pointsStd,
        pointsPpr,
        pointsHalf,
        stats: numericStats,
      });
      rankingRows.push({ fpid, adpStd, adpPpr, adpHalf });
    }

    const playersResult = await ctx.runMutation(api.players.upsertPlayers, {
      rows: playerRows,
    });
    const projectionsResult = (BLENDED_POSITIONS as readonly string[]).includes(
      position,
    )
      ? await ctx.runMutation(
          api.providerProjections.upsertProviderProjections,
          {
            provider: "sleeper",
            position,
            season,
            week: args.week,
            rows: projectionRows.map((row) => ({
              fpid: row.fpid,
              stats: row.stats,
            })),
          },
        )
      : await ctx.runMutation(api.projections.upsertProjections, {
          position,
          season,
          week: args.week,
          rows: projectionRows,
        });
    const rankingsResult = await ctx.runMutation(
      api.rankings.upsertRankings,
      { position, season, week: args.week, rows: rankingRows },
    );

    results[position] = {
      players: playersResult,
      projections: projectionsResult,
      rankings: rankingsResult,
    };
  }

  return results as FetchProjectionsResult;
}

export const fetchProjections = action({
  args: {
    week: v.string(),
    season: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return fetchProjectionsHandler(ctx, args);
  },
});

// Cron-safe counterpart with no human-auth check - a cron-triggered function
// call runs with no signed-in user (ctx.auth.getUserIdentity() is always
// null there), so a requireSuperAdmin-gated action can never succeed from
// convex/crons.ts. Only fetchAllData.fetchAllInternal calls this; the public
// fetchProjections above (used by the Settings > Data panel) stays gated.
export const fetchProjectionsInternal = internalAction({
  args: {
    week: v.string(),
    season: v.optional(v.string()),
  },
  handler: fetchProjectionsHandler,
});
