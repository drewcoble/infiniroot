export { requireSuperAdmin, currentSeason } from "../lib/dataFetch";

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

// ESPN's proTeamId -> this app's (Sleeper's) team abbreviation - for D/ST
// entries (ESPN's D/ST player id is -16000 - proTeamId; our DST fpids are
// synthetic and never carry an espnId - see DEF_TEAM_FPIDS) and the
// last-name name-match fallback. Spot-checked live against a real roster's
// players' proTeamIds. 0 = free agent, deliberately absent.
export const ESPN_PRO_TEAM_ABBR: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

export interface EspnPlayer {
  id: number;
  fullName?: string;
  proTeamId?: number;
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
