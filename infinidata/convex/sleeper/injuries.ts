import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { ApplyInjuryFetchResult } from "../injuries";
import { fetchCurrentNflWeek } from "./state";
import {
  currentSeason,
  DEF_TEAM_FPIDS,
  fetchSleeper,
  INJURY_STATUS_SHORT,
  POSITION_SLUGS,
  requireSuperAdmin,
  SleeperProjectionRecord,
} from "./client";

// Sleeper's raw position slugs this app tracks injuries for - same set
// sleeper/projections.ts requests, just not mapped to our own Position enum
// since injury rows have no position field of their own (see convex/
// injuries.ts's schema).
const VALID_SLEEPER_POSITIONS = new Set(Object.values(POSITION_SLUGS));

// Reuses the same "projections" endpoint sleeper/projections.ts calls
// (Sleeper has no dedicated injury endpoint - injury_status/injury_body_part/
// injury_notes just ride along on every player record there), but skips that
// file's players/projections/rankings/providerProjections upserts entirely -
// this only hands the parsed rows to convex/injuries.ts's applyInjuryFetch,
// which writes nothing unless something actually changed. That keeps each
// run cheap enough to justify the 15-minute cadence in convex/crons.ts.
async function fetchInjuriesHandler(
  ctx: ActionCtx,
  args: { week?: string; season?: string },
): Promise<ApplyInjuryFetchResult> {
  const week = args.week ?? (await fetchCurrentNflWeek());
  const season = args.season ?? currentSeason();
  // The app's "0" (season-long) sentinel maps to omitting the week path
  // segment entirely - same convention as fetchProjectionsHandler.
  const apiWeek = week === "0" ? undefined : week;

  const records: SleeperProjectionRecord[] = await fetchSleeper(
    "projections",
    season,
    apiWeek,
    Object.values(POSITION_SLUGS),
  );

  const injuryRows: Array<{
    fpid: number;
    status: string;
    statusShort: string;
    injuryType: string;
    comment: string;
    practice1: string | null;
    practice2: string | null;
    practice3: string | null;
    practiceReportInjuryType: string | null;
  }> = [];

  for (const record of records) {
    const sleeperPosition = record.player?.position;
    if (!sleeperPosition || !VALID_SLEEPER_POSITIONS.has(sleeperPosition)) {
      continue;
    }

    const fpid =
      sleeperPosition === "DEF"
        ? DEF_TEAM_FPIDS[record.team ?? ""]
        : Number(record.player_id);
    if (!fpid) continue;

    // Same free-agent/practice-squad filter as sleeper/projections.ts - a
    // player not currently on an NFL roster is almost never fantasy-relevant,
    // and this table has no "which players do we even care about" filter of
    // its own otherwise. DST records use `team` as their own identity (the
    // fpid lookup above already requires it).
    if (sleeperPosition !== "DEF" && !record.team) continue;

    const status = record.player?.injury_status;
    if (!status) continue;

    injuryRows.push({
      fpid,
      status,
      statusShort: INJURY_STATUS_SHORT[status] ?? status,
      injuryType: record.player?.injury_body_part ?? "",
      comment: record.player?.injury_notes ?? "",
      practice1: null,
      practice2: null,
      practice3: null,
      practiceReportInjuryType: null,
    });
  }

  return await ctx.runMutation(internal.injuries.applyInjuryFetch, {
    season,
    week,
    rows: injuryRows,
  });
}

export const fetchInjuries = action({
  args: {
    week: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    return fetchInjuriesHandler(ctx, args);
  },
});

// Cron-safe counterpart with no human-auth check - a cron-triggered function
// call runs with no signed-in user (ctx.auth.getUserIdentity() is always
// null there), so the requireSuperAdmin-gated fetchInjuries above can never
// succeed from convex/crons.ts. This is what the 15-minute injury cron
// actually calls.
export const fetchInjuriesInternal = internalAction({
  args: {
    week: v.optional(v.string()),
    season: v.optional(v.string()),
  },
  handler: fetchInjuriesHandler,
});
