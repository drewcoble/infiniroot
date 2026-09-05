import { v } from "convex/values";
import { query, QueryCtx } from "../../_generated/server";
import { POSITIONS } from "../../positions";
import type { Id } from "../../_generated/dataModel";
import { requireSeasonParticipant } from "../../lib/access";
import { getEligibleFpidSet } from "./eligibility";

export type Position = (typeof POSITIONS)[number];

export interface PlayerDisplayInfo {
  name: string;
  team: string | null;
  position: Position;
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  injury?: { status: string; statusShort: string };
}

// Shared "join fpid -> rank/PPG/injury" logic for any player-list display -
// getWaiverEligiblePlayers (Players tab) and getBidsBoard (bids.ts's Bids
// tab, which needs the same PlayerCard-shaped info for its own smaller set
// of actively-bid-on fpids) both build on this instead of duplicating the
// rosVorSnapshots/injuries join and position-rank computation a third time.
//
// The base source is the `players` table itself (always populated), NOT
// rosVorSnapshots - a freshly-connected season has zero rosVorSnapshots
// rows until convex/rosVor.ts's refreshRosVor next runs (once/day via
// fetchAllData.ts), which showed up as a real bug: a brand-new league's
// Players tab was empty regardless of eligibility, because the ranking
// cache itself was empty, not because nothing was eligible. Rank/PPG are
// layered on top from rosVorSnapshots when available (real numbers once
// the cache has run) and fall back to the same "0 = no rank, don't
// fabricate one" sentinel PlayerCard already treats specially.
//
// positionRank is always computed from the FULL league-wide board, not
// just `fpids` - "RB14" should mean 14th-best RB leaguewide, not 14th-best
// RB among only whatever subset the caller asked about.
export async function getPlayerDisplayInfoByFpid(
  ctx: QueryCtx,
  seasonId: Id<"seasons">,
  fpids: Set<number>,
): Promise<Map<number, PlayerDisplayInfo>> {
  const [allPlayers, injuries, nflState] = await Promise.all([
    ctx.db.query("players").collect(),
    ctx.db.query("injuries").collect(),
    ctx.db.query("nflState").first(),
  ]);
  const injuryByFpid = new Map(injuries.map((row) => [row.fpid, row]));

  const snapshotRows = nflState
    ? await ctx.db
        .query("rosVorSnapshots")
        .withIndex("by_season_week", (q) =>
          q.eq("seasonId", seasonId).eq("week", String(nflState.week)),
        )
        .collect()
    : [];
  const snapshotByFpid = new Map(snapshotRows.map((row) => [row.fpid, row]));

  const byPosition = new Map<Position, typeof snapshotRows>();
  for (const row of snapshotRows) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row);
    byPosition.set(row.position, list);
  }
  const positionRankByFpid = new Map<number, number>();
  for (const list of byPosition.values()) {
    [...list]
      .sort((a, b) => b.rosVor - a.rosVor)
      .forEach((row, index) => positionRankByFpid.set(row.fpid, index + 1));
  }

  const result = new Map<number, PlayerDisplayInfo>();
  for (const player of allPlayers) {
    if (!fpids.has(player.fpid)) continue;
    const snapshot = snapshotByFpid.get(player.fpid);
    const injury = injuryByFpid.get(player.fpid);
    result.set(player.fpid, {
      name: player.name,
      team: player.team,
      position: player.position,
      rosRank: snapshot?.rosRank ?? 0,
      positionRank: positionRankByFpid.get(player.fpid) ?? 0,
      rosPpg: snapshot?.rosPpg ?? 0,
      actualPpg: snapshot?.actualPpg ?? 0,
      ...(injury ? { injury: { status: injury.status, statusShort: injury.statusShort } } : {}),
    });
  }
  return result;
}

export interface WaiverPlayerRow extends PlayerDisplayInfo {
  fpid: number;
  rosteredByTeamName: null;
}

// infinifaab's Players tab - every currently-unowned, waiver-eligible
// player (see eligibility.ts's getEligibleFpidSet), gated by
// requireSeasonParticipant instead of rosVor.ts's own getRosVorBoard
// (requireSeasonOwner) - an invited team owner needs to see this list, not
// just the commissioner.
export const getWaiverEligiblePlayers = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<WaiverPlayerRow[]> => {
    const { season } = await requireSeasonParticipant(ctx, args.seasonId);
    const eligibleFpids = await getEligibleFpidSet(ctx, season);
    const displayByFpid = await getPlayerDisplayInfoByFpid(ctx, args.seasonId, eligibleFpids);

    const rows: WaiverPlayerRow[] = [...displayByFpid.entries()].map(([fpid, info]) => ({
      fpid,
      ...info,
      rosteredByTeamName: null,
    }));

    // Real rank when the cache has data (0 = "no rank" sentinel sorts
    // last); alphabetical fallback so the list still reads as a real,
    // scannable board before the cache has ever run for this season.
    const hasRankData = rows.some((row) => row.rosRank > 0);
    rows.sort((a, b) =>
      hasRankData ? (a.rosRank || Infinity) - (b.rosRank || Infinity) : a.name.localeCompare(b.name),
    );
    return rows;
  },
});
