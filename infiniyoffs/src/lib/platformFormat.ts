import { standardBracket } from "@playoffRules/presets";
import type { PlayoffFormat } from "@playoffRules/format";
import type { SeasonData } from "./seasonData";

// The platform's own playoffs as a PlayoffFormat, so a league with no
// custom rules gets the same picture, odds and what-ifs: its playoff team
// count and round weeks, top seeds getting the byes.
export function platformFormat(data: SeasonData): PlayoffFormat | null {
  const playoffs = data.platformPlayoffs;
  if (!playoffs?.hasPlayoffs || playoffs.playoffTeamCount < 2) return null;
  const format = standardBracket({
    teamCount: data.teams.length,
    regularSeasonEndWeek: playoffs.regularSeasonEndWeek,
    playoffTeams: playoffs.playoffTeamCount,
  });
  const rounds = playoffs.tournaments[0]?.rounds.map((round) => round.weeks);
  const bracket = format.stages[0];
  if (bracket?.kind === "bracket" && rounds?.length && rounds.every((weeks) => weeks.length)) {
    bracket.roundWeeks = rounds;
  }
  return format;
}
