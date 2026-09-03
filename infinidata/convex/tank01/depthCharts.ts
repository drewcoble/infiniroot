"use node";

import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireSuperAdmin, fetchTank01DepthCharts } from "./client";

// Tank01 -> our position literals. Only the 5 fantasy-relevant ones; LB/DL/DB
// (defense) entries are silently dropped - see client.ts's comment on why
// they show up at all. "PK" is Tank01's own label for kicker.
const TANK01_POSITION_TO_OURS: Record<
  string,
  "QB" | "RB" | "WR" | "TE" | "K"
> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  PK: "K",
};

async function fetchTank01DepthChartsHandler(
  ctx: ActionCtx,
): Promise<{ upserted: number; removed: number; unmatched: number }> {
  const teams = await fetchTank01DepthCharts();

  // Same espnId->fpid map convex/espn/rankings.ts builds - see that file's
  // comment for why this is a client-side join rather than a query.
  const ourPlayers = await ctx.runQuery(internal.players.listForNameMatch, {});
  const byEspnId = new Map<number, number>();
  for (const player of ourPlayers) {
    if (player.espnId !== undefined) byEspnId.set(player.espnId, player.fpid);
  }

  let upserted = 0;
  let removed = 0;
  let unmatched = 0;

  for (const team of teams) {
    for (const [tank01Position, ourPosition] of Object.entries(
      TANK01_POSITION_TO_OURS,
    )) {
      const entries = team.depthChart[tank01Position] ?? [];
      const rows: Array<{ depthPosition: string; fpid: number }> = [];

      for (const entry of entries) {
        const fpid = byEspnId.get(Number(entry.playerID));
        if (fpid === undefined) {
          unmatched += 1;
          continue;
        }
        rows.push({ depthPosition: entry.depthPosition, fpid });
      }

      const result = await ctx.runMutation(
        internal.tank01.depthChartsData.upsertTeamPositionDepthChart,
        { team: team.teamAbv, position: ourPosition, rows },
      );
      upserted += result.upserted;
      removed += result.removed;
    }
  }

  return { upserted, removed, unmatched };
}

export const fetchDepthCharts = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ upserted: number; removed: number; unmatched: number }> => {
    await requireSuperAdmin(ctx);
    return await fetchTank01DepthChartsHandler(ctx);
  },
});

// Cron-safe counterpart with no human-auth check - see fetchAllData.ts's
// fetchAllInternal for why this split exists.
export const fetchDepthChartsInternal = internalAction({
  args: {},
  handler: async (ctx) => await fetchTank01DepthChartsHandler(ctx),
});
