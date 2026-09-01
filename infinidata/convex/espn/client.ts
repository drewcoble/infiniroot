export { requireSuperAdmin, currentSeason } from "../fantasyPros/client";

/**
 * ESPN's fantasy football player API (undocumented, no API key needed for
 * reads). Confirmed live: the numeric `id` on a player object here is the
 * same id Sleeper's full player list (see convex/sleeper/playerLinks.ts)
 * stores as espn_id, so the two sources join on that id directly - no name
 * matching needed. `scoringPeriodId=0` is ESPN's own "full season" sentinel
 * (a per-week id would scope draftRanksByRankType to one week instead).
 *
 * The `X-Fantasy-Filter` header's presence (any value) is what unlocks the
 * full player pool - omit it and ESPN silently caps the response at its
 * default 50-player page. Its documented `limit`/`sortDraftRanks` keys,
 * which other integrations use to request just a top-N slice pre-sorted,
 * are both silently ignored on this endpoint - confirmed live, every
 * combination tried still returned the full ~11.6k-player pool in its own
 * id order. So this fetches everyone (~35-40MB) and does the SUPERFLEX
 * filter/sort/rank read client-side instead (see convex/espn/rankings.ts).
 */
const API_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

export interface EspnPlayer {
  id: number;
  fullName?: string;
  // ESPN's own position id (1=QB, 2=RB, 3=WR, 4=TE, 5=K, confirmed
  // empirically - see convex/espn/rankings.ts's ESPN_POSITION_TO_OURS).
  defaultPositionId?: number;
  draftRanksByRankType?: Record<
    string,
    { rank?: number; auctionValue?: number }
  >;
  // Per-period projected/actual stat blocks - scoringPeriodId 0 is the
  // season-long total, 1-18 are individual weeks; statSourceId 1 is
  // projected (0 is actual, once games have been played). Each block's
  // `stats` map is keyed by ESPN's own numeric stat ids (see convex/espn/
  // rankings.ts's ESPN_STAT_ID_TO_CATEGORY for the crosswalk into this
  // app's category names).
  stats?: Array<{
    scoringPeriodId: number;
    seasonId: number;
    statSourceId: number;
    stats: Record<string, number>;
  }>;
}

export async function fetchEspnPlayers(season: string): Promise<EspnPlayer[]> {
  const url = `${API_BASE_URL}/seasons/${season}/players?scoringPeriodId=0&view=kona_player_info`;
  const response = await fetch(url, {
    headers: {
      "x-fantasy-filter": JSON.stringify({
        players: { filterStatsForTopScoringPeriodIds: { value: 0 } },
      }),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ESPN players request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  return await response.json();
}
