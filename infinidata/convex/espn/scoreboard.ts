import { normalizeNflTeam, type LiveGame } from "../lib/liveGames";

// ESPN's public site scoreboard - no key, one call for a whole week's
// slate. Undocumented (same caveat as espn/client.ts's fantasy API): its
// shape was verified live, but it can change without notice, which is why
// callers treat a failure here as "no game status this poll" rather than
// failing the whole live poll.
const SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

interface EspnScoreboard {
  events?: Array<{
    competitions?: Array<{
      competitors?: Array<{ team?: { abbreviation?: string } }>;
      status?: {
        period?: number;
        clock?: number;
        type?: { state?: string; name?: string };
      };
    }>;
  }>;
}

// One entry per TEAM (both sides of every game), keyed by our own team
// codes - callers look status up by a player's team, never by game.
export async function fetchEspnWeekGames(season: string, week: string): Promise<LiveGame[]> {
  const url = `${SCOREBOARD_URL}?seasontype=2&week=${encodeURIComponent(week)}&dates=${encodeURIComponent(season)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN scoreboard request failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as EspnScoreboard;

  const games: LiveGame[] = [];
  for (const event of data.events ?? []) {
    const competition = event.competitions?.[0];
    const status = competition?.status;
    const state = status?.type?.state;
    if (state !== "pre" && state !== "in" && state !== "post") continue;
    for (const competitor of competition?.competitors ?? []) {
      const abbreviation = competitor.team?.abbreviation;
      if (!abbreviation) continue;
      games.push({
        team: normalizeNflTeam(abbreviation),
        state,
        period: status?.period ?? 0,
        clockSeconds: status?.clock ?? 0,
        statusName: status?.type?.name ?? "",
      });
    }
  }
  return games.sort((a, b) => (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));
}
