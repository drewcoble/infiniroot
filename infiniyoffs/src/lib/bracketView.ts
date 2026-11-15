import type { SeasonInput, StageResult } from "@playoffRules/evaluate";
import type { PlayoffFormat, Stage } from "@playoffRules/format";
import type { BracketTournament } from "@shared/glass/TournamentBracket";

// The engine's input as if the regular season ended today: today's
// standings are final, and nothing after the last final week has been
// played - so later stages show who'd be where, with every game ahead.
export function ifEndedTodayInput(format: PlayoffFormat, input: SeasonInput): SeasonInput {
  if (input.finalThroughWeek >= format.regularSeasonEndWeek) return input;
  const points: SeasonInput["points"] = {};
  for (const [teamId, byWeek] of Object.entries(input.points)) {
    points[teamId] = Object.fromEntries(
      Object.entries(byWeek).filter(([week]) => Number(week) <= input.finalThroughWeek),
    );
  }
  return { ...input, points, finalThroughWeek: format.regularSeasonEndWeek };
}

export function stageWeeks(stage: Stage): number[] {
  return stage.kind === "bracket" ? stage.roundWeeks.flat() : stage.weeks;
}

// A bracket stage's rounds in the shared bracket's shape.
export function stageTournament(result: StageResult): BracketTournament {
  const rounds = (result.rounds ?? []).map((round) => ({
    round: round.round,
    name: round.name,
    weeks: round.weeks,
    games: round.games.map((game) => ({
      id: game.id,
      entrants: [0, 1].map((side) => {
        const teamId = game.teamIds[side] ?? null;
        return {
          teamId,
          seed: teamId !== null ? (result.seeds[teamId] ?? null) : null,
          points: game.points[side] ?? null,
          fromGameId: game.from?.[side] ?? null,
        };
      }) as BracketTournament["rounds"][number]["games"][number]["entrants"],
      winnerTeamId: game.winnerId,
    })),
  }));
  return { rounds, championTeamId: result.advancers?.[0] ?? null };
}
