export { requireSuperAdmin, currentSeason } from "../lib/dataFetch";

import { processEnv } from "../lib/env";

/**
 * Tank01's NFL data API, accessed via RapidAPI (unlike Sleeper/ESPN, this
 * one requires a paid key - see TANK01_API_KEY below). Confirmed live:
 * Tank01's numeric playerID is the same id ESPN uses (and therefore the
 * same one Sleeper's full player list stores as espn_id, see
 * convex/sleeper/playerLinks.ts) - so this joins onto players.espnId
 * directly, same as convex/espn/client.ts, no name matching needed for the
 * common case. ~23% of tracked skill players have no espnId at all yet
 * (Sleeper's own coverage gap, not a matching bug - see conversation
 * history), so a meaningful minority of Tank01 rows won't resolve to an
 * fpid until that's improved upstream.
 */
const API_HOST = "tank01-nfl-live-in-game-real-time-statistics-nfl.p.rapidapi.com";
const API_BASE_URL = `https://${API_HOST}`;

export interface Tank01DepthChartEntry {
  depthPosition: string; // e.g. "RB1"
  playerID: string;
  longName: string;
}

// Keyed by Tank01's own position codes - QB/RB/WR/TE/PK are the ones we
// care about; LB/DL/DB (defense) also come back despite this endpoint being
// called "Offensive Depth Charts", see convex/tank01/depthCharts.ts for
// where those get filtered out.
export interface Tank01TeamDepthChart {
  teamID: string;
  teamAbv: string;
  depthChart: Record<string, Tank01DepthChartEntry[]>;
}

function requireApiKey(): string {
  const key = processEnv?.TANK01_API_KEY;
  if (!key) {
    throw new Error(
      "TANK01_API_KEY is not set - sign up for the tank01-fantasy-stats API on RapidAPI and set it as a Convex env var.",
    );
  }
  return key;
}

export async function fetchTank01DepthCharts(): Promise<
  Tank01TeamDepthChart[]
> {
  const response = await fetch(`${API_BASE_URL}/getNFLDepthCharts`, {
    headers: {
      "x-rapidapi-key": requireApiKey(),
      "x-rapidapi-host": API_HOST,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tank01 depth charts request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  const json = await response.json();
  return json.body as Tank01TeamDepthChart[];
}

// One row per real NFL game - confirmed live shape against /getNFLGamesForWeek.
// gameTime_epoch is a real Unix-seconds kickoff timestamp as a numeric
// string - no timezone parsing needed, unlike gameTime's human-readable
// "8:20p" (which is not used here). home/away are Tank01's own team
// abbreviations, which do NOT always match this app's Sleeper-derived
// players.team convention - confirmed live mismatch: Washington is "WSH"
// here vs "WAS" on players.team, same discrepancy depthChartsData.ts
// documents for depth charts. See convex/sleeper/transactions.ts's
// TANK01_TEAM_ALIASES for the one normalization this requires.
export interface Tank01ScheduleGame {
  gameID: string;
  home: string;
  away: string;
  gameTime_epoch: string;
}

export async function fetchTank01WeeklySchedule(
  week: string,
  season: string,
): Promise<Tank01ScheduleGame[]> {
  const response = await fetch(
    `${API_BASE_URL}/getNFLGamesForWeek?week=${encodeURIComponent(week)}&season=${encodeURIComponent(season)}&seasonType=reg`,
    {
      headers: {
        "x-rapidapi-key": requireApiKey(),
        "x-rapidapi-host": API_HOST,
      },
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Tank01 schedule request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  const json = await response.json();
  return json.body as Tank01ScheduleGame[];
}
