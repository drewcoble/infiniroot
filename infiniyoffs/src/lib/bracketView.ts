import type { GameResult, SeasonInput, StageResult } from "@playoffRules/evaluate";
import { stageWeeks, type DoubleElimStage, type PlayoffFormat } from "@playoffRules/format";
import type { BracketExtraColumn, BracketTournament } from "@shared/glass/TournamentBracket";

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

export { stageWeeks };

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

type BracketGame = BracketTournament["rounds"][number]["games"][number];
type BracketEntrant = BracketGame["entrants"][number];

// A double elimination as two brackets for the swipeable view - the
// unbeaten side (one round per bracket week) and the once-beaten side
// (from the first week anyone has lost). Each team links to the game it
// came from; a team that just dropped from the unbeaten side reads "From
// WB". Weeks not set yet are TBD games, sized by how many teams each side
// will have, so the whole bracket shows from the start.
export function doubleElimBrackets(
  stage: DoubleElimStage,
  result: StageResult,
): {
  winners: BracketTournament;
  losers: BracketTournament;
  winnersExtra: BracketExtraColumn[];
  losersExtra: BracketExtraColumn[];
} {
  const de = result.doubleElim;
  const seed = (teamId: string | null) =>
    teamId !== null ? (result.seeds[teamId] ?? null) : null;

  // Games per week on each side, from the field size alone.
  let unbeaten = result.entrants?.length ?? 0;
  let onceBeaten = 0;
  const counts = stage.weeks.map(() => {
    const winners = Math.floor(unbeaten / 2);
    const losers = Math.floor(onceBeaten / 2);
    onceBeaten = losers + (onceBeaten % 2) + winners;
    unbeaten = winners + (unbeaten % 2);
    return { winners, losers };
  });

  const build = (side: "winners" | "losers"): BracketTournament => {
    const rounds: BracketTournament["rounds"] = [];
    let previous: BracketGame[] = [];
    let previousWinners: BracketGame[] = [];
    stage.weeks.forEach((week, i) => {
      const actual = de?.weeks.find((w) => w.week === week);
      const count = counts[i]![side];
      const weekWinners = actual?.winners ?? [];
      if (count === 0) {
        previousWinners = weekWinners.map(toGame(seed, [], []));
        return;
      }
      const games: BracketGame[] = actual
        ? actual[side].map(toGame(seed, previous, side === "losers" ? previousWinners : []))
        : Array.from({ length: count }, (_, g) => ({
            id: `${side}w${week}g${g + 1}`,
            entrants: (side === "winners"
              ? [previous[2 * g], previous[2 * g + 1]]
              : [previous[g], undefined]
            ).map((feeder) => tbd(feeder?.id ?? null)) as [BracketEntrant, BracketEntrant],
            winnerTeamId: null,
          }));
      const round = rounds.length + 1;
      rounds.push({ round, name: `Round ${round}`, weeks: [week], games });
      previous = games;
      previousWinners = weekWinners.map(toGame(seed, [], []));
    });
    return { rounds, championTeamId: null };
  };
  // The Royal Rumble's field size once the bracket weeks are played.
  const rumbleSize = unbeaten + onceBeaten;
  const rumbleEntries = de?.rumble
    ? de.rumble.entries.map(({ teamId, points }) => ({
        teamId,
        seed: seed(teamId),
        points,
        fromGameId: null,
      }))
    : Array.from({ length: rumbleSize }, () => tbd(null));
  const rumble: BracketExtraColumn = {
    key: "rumble",
    name: "Royal Rumble",
    weeks: [stage.rumbleWeek],
    games: [{ id: "rumble", entrants: rumbleEntries, winnerTeamId: de?.rumble?.winnerId ?? null }],
    caption: "Top score wins",
  };
  const finalGame = de?.final;
  const unbeatenWonRumble =
    de?.rumble?.winnerId != null && de.unbeaten.includes(de.rumble.winnerId);
  const final: BracketExtraColumn = {
    key: "final",
    name: "Final",
    weeks: [stage.finalWeek],
    games: unbeatenWonRumble
      ? []
      : [
          finalGame
            ? {
                id: finalGame.id,
                entrants: finalGame.teamIds.map((teamId, side) => ({
                  teamId,
                  seed: seed(teamId),
                  points: finalGame.points[side] ?? null,
                  fromGameId: null,
                })),
                winnerTeamId: finalGame.winnerId,
              }
            : { id: "final", entrants: [tbd(null), tbd(null)], winnerTeamId: null },
        ],
    caption: unbeatenWonRumble
      ? "Not needed - the unbeaten team won the Rumble"
      : finalGame
        ? undefined
        : "If a once-beaten team wins the Rumble",
  };
  return {
    winners: build("winners"),
    losers: build("losers"),
    winnersExtra: [rumble, final],
    losersExtra: [rumble],
  };
}

function tbd(fromGameId: string | null): BracketEntrant {
  return { teamId: null, seed: null, points: null, fromGameId };
}

// An engine game as a bracket game: each team linked to the game it won
// last week on this side, else marked as dropped from the unbeaten side.
function toGame(
  seed: (teamId: string | null) => number | null,
  previous: BracketGame[],
  droppedFrom: BracketGame[],
) {
  return (game: GameResult): BracketGame => ({
    id: game.id,
    entrants: [0, 1].map((side) => {
      const teamId = game.teamIds[side] ?? null;
      const feeder = previous.find((p) => p.winnerTeamId !== null && p.winnerTeamId === teamId);
      const lostUnbeaten = droppedFrom.some(
        (p) =>
          p.winnerTeamId !== null &&
          p.winnerTeamId !== teamId &&
          p.entrants.some((entrant) => entrant.teamId === teamId),
      );
      const dropped = !feeder && lostUnbeaten;
      return {
        teamId,
        seed: seed(teamId),
        points: game.points[side] ?? null,
        fromGameId: feeder?.id ?? null,
        ...(dropped ? { note: "From WB" } : {}),
      };
    }) as [BracketEntrant, BracketEntrant],
    winnerTeamId: game.winnerId,
  });
}
