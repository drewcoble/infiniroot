import { createContext, useContext, type ReactNode } from "react";
import { api } from "@infinidata/api";

// The league reads the shared matchup and player UI makes. Each is
// owner-gated in infinileague; infiniyoffs serves member-gated copies with
// the same args and results (convex/infiniyoffs/reads.ts) and provides
// those instead. Defaults to infinileague's.
export interface LeagueApi {
  getStandings: typeof api.infinileague.season.standings.getStandings;
  getRosVorBoard: typeof api.rosVor.getRosVorBoard;
  getWeekPoints: typeof api.rosVor.getWeekPoints;
  getWeekPositionRanks: typeof api.infinileague.season.matchup.getWeekPositionRanks;
  getMatchupDifficulty: typeof api.infinileague.season.matchupDifficulty.getMatchupDifficulty;
  getGameLog: typeof api.infinileague.season.gameLog.getGameLog;
  getGameLogSeasons: typeof api.infinileague.season.gameLog.getGameLogSeasons;
  getUsageWeeks: typeof api.infinileague.season.usage.getUsageWeeks;
  getTeamRosterForWeek: typeof api.infinileague.season.teamRoster.getTeamRosterForWeek;
}

const INFINILEAGUE_API: LeagueApi = {
  getStandings: api.infinileague.season.standings.getStandings,
  getRosVorBoard: api.rosVor.getRosVorBoard,
  getWeekPoints: api.rosVor.getWeekPoints,
  getWeekPositionRanks: api.infinileague.season.matchup.getWeekPositionRanks,
  getMatchupDifficulty: api.infinileague.season.matchupDifficulty.getMatchupDifficulty,
  getGameLog: api.infinileague.season.gameLog.getGameLog,
  getGameLogSeasons: api.infinileague.season.gameLog.getGameLogSeasons,
  getUsageWeeks: api.infinileague.season.usage.getUsageWeeks,
  getTeamRosterForWeek: api.infinileague.season.teamRoster.getTeamRosterForWeek,
};

const LeagueApiContext = createContext<LeagueApi>(INFINILEAGUE_API);

export function LeagueApiProvider({ value, children }: { value: LeagueApi; children: ReactNode }) {
  return <LeagueApiContext.Provider value={value}>{children}</LeagueApiContext.Provider>;
}

export function useLeagueApi(): LeagueApi {
  return useContext(LeagueApiContext);
}
