import { v } from "convex/values";
import { internalMutation, query } from "../_generated/server";
import { positionValidator } from "../positions";
import { Doc } from "../_generated/dataModel";

// Patch-or-insert each role slot, then prune any row for this (team,
// position) that didn't reappear in this fetch - mirrors projections.ts's
// upsertProjections. Scoped to one (team, position) per call rather than
// one call for the whole payload, same chunking reasoning as
// convex/sleeper/playerLinks.ts (keeps each transaction's read/write count
// small and independent of total roster size). Split out from
// depthCharts.ts because that file is "use node" (the fetch call needs the
// Node runtime) and mutations can't live in a Node-runtime file.
export const upsertTeamPositionDepthChart = internalMutation({
  args: {
    team: v.string(),
    position: positionValidator,
    rows: v.array(
      v.object({ depthPosition: v.string(), fpid: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("depthCharts")
      .withIndex("by_team_position", (q) =>
        q.eq("team", args.team).eq("position", args.position),
      )
      .collect();
    const existingByDepthPosition = new Map(
      existing.map((row) => [row.depthPosition, row]),
    );
    const now = Date.now();
    const seen = new Set<string>();

    for (const row of args.rows) {
      seen.add(row.depthPosition);
      const match = existingByDepthPosition.get(row.depthPosition);
      if (match) {
        await ctx.db.patch(match._id, { fpid: row.fpid, updatedAt: now });
      } else {
        await ctx.db.insert("depthCharts", {
          team: args.team,
          position: args.position,
          depthPosition: row.depthPosition,
          fpid: row.fpid,
          updatedAt: now,
        });
      }
    }

    let removed = 0;
    for (const row of existing) {
      if (!seen.has(row.depthPosition)) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    return { upserted: args.rows.length, removed };
  },
});

// Distinct teams currently synced - drives the Depth Charts tab's team
// selector. Deliberately not a hardcoded 32-team constant: this table's
// `team` values are Tank01's own abbreviations (see client.ts), which don't
// always match this app's Sleeper-derived convention elsewhere (e.g.
// Washington is "WSH" here vs "WAS" on players.team) - reading the real
// distinct values back out avoids ever hardcoding a list that could drift
// from what's actually stored. Empty until the first sync runs.
export const listDepthChartTeams = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("depthCharts").collect();
    return [...new Set(rows.map((row) => row.team))].sort();
  },
});

export interface DepthChartPlayerRow {
  fpid: number;
  name: string;
  position: Doc<"players">["position"];
  depthPosition: string;
}

// One team's full fantasy-relevant depth chart (QB/RB/WR/TE/K only - that's
// all upsertTeamPositionDepthChart above ever writes), joined against
// `players` for display name. No PPG/positionRank/rosteredByTeamName here -
// the Depth Charts tab already has that from its own getRosVorBoard
// subscription and joins client-side by fpid, so this stays a thin read off
// depthCharts rather than duplicating rosVor.ts's league-wide computation
// for a ~25-row team subset.
export const getTeamDepthChart = query({
  args: { team: v.string() },
  handler: async (ctx, args): Promise<DepthChartPlayerRow[]> => {
    const rows = await ctx.db
      .query("depthCharts")
      .withIndex("by_team", (q) => q.eq("team", args.team))
      .collect();

    const players = await Promise.all(
      rows.map((row) =>
        ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", row.fpid))
          .first(),
      ),
    );

    const out: DepthChartPlayerRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const player = players[i];
      // Shouldn't happen (getTeamDepthChart's own sync only ever writes an
      // fpid it just resolved via players.espnId), but a player row could
      // theoretically be deleted out from under this fpid afterward - skip
      // rather than render a name-less card.
      if (!row || !player) continue;
      out.push({
        fpid: row.fpid,
        name: player.name,
        position: row.position,
        depthPosition: row.depthPosition,
      });
    }
    return out;
  },
});
