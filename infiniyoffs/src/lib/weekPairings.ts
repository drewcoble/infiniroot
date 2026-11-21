import type { PlayoffState } from "@playoffRules/evaluate";
import type { PlayoffFormat } from "@playoffRules/format";
import type { StandingsRow } from "@shared/league/types/season";
import type { SeasonData } from "./seasonData";

export interface WeekPairing {
  teamAId: string;
  teamBId: string;
  // The stage or round, for a playoff week - e.g. "Group Stage", "Final".
  label?: string;
  // Each side's bonus for the week.
  bonus: [number, number];
}

// The week's head-to-head games: the platform schedule in the regular
// season; the league's own playoff games after it (the engine's group and
// bracket games, or the platform's bracket without custom rules). Null for
// a playoff week whose games aren't set yet.
export function weekPairings(
  data: SeasonData,
  format: PlayoffFormat,
  isCustom: boolean,
  state: PlayoffState,
  week: number,
): WeekPairing[] | null {
  if (week <= format.regularSeasonEndWeek) {
    return data.schedule
      .filter((game) => game.weeks.includes(week))
      .map(({ teamIds: [teamAId, teamBId] }) => ({ teamAId, teamBId, bonus: [0, 0] }));
  }

  const pairings: WeekPairing[] = [];
  if (!isCustom) {
    for (const tournament of data.platformPlayoffs?.tournaments ?? []) {
      for (const round of tournament.rounds) {
        if (!round.weeks.includes(week)) continue;
        for (const game of round.games) {
          const [a, b] = game.entrants;
          if (a.teamId && b.teamId) {
            pairings.push({
              teamAId: a.teamId,
              teamBId: b.teamId,
              label: round.name,
              bonus: [0, 0],
            });
          }
        }
      }
    }
    return pairings.length ? pairings : null;
  }

  const brackets = format.stages.filter((stage) => stage.kind === "bracket").length;
  for (const stage of format.stages) {
    const result = state.stages[stage.id];
    const de = result?.doubleElim;
    const games =
      stage.kind === "groups"
        ? (result?.groups ?? []).flatMap((group) =>
            group.games.map((game) => ({ game, label: stage.name })),
          )
        : de
          ? [
              ...de.weeks.flatMap((w) => [
                ...w.winners.map((game) => ({ game, label: "Winners bracket" })),
                ...w.losers.map((game) => ({ game, label: "Losers bracket" })),
              ]),
              ...(de.final ? [{ game: de.final, label: "Final" }] : []),
            ]
          : (result?.rounds ?? []).flatMap((round) =>
            round.games.map((game) => ({
              game,
              label: brackets > 1 ? `${stage.name} · ${round.name}` : round.name,
            })),
          );
    for (const { game, label } of games) {
      const [a, b] = game.teamIds;
      if (!game.weeks.includes(week) || a === null || b === null) continue;
      const perWeek = (bonus: number) => bonus / game.weeks.length;
      pairings.push({
        teamAId: a,
        teamBId: b,
        label,
        bonus: [perWeek(game.bonus[0]), perWeek(game.bonus[1])],
      });
    }
  }
  return pairings.length ? pairings : null;
}

// A double elimination's Royal Rumble field, if `week` is its Rumble and
// the field is set - every team plays everyone, so there are no pairings.
export function rumbleField(
  format: PlayoffFormat,
  state: PlayoffState,
  week: number,
): string[] | null {
  for (const stage of format.stages) {
    if (stage.kind !== "doubleElim" || stage.rumbleWeek !== week) continue;
    const rumble = state.stages[stage.id]?.doubleElim?.rumble;
    return rumble ? rumble.entries.map((entry) => entry.teamId) : null;
  }
  return null;
}

// Whether `week` is a Royal Rumble week, field set or not.
export function isRumbleWeek(format: PlayoffFormat, week: number): boolean {
  return format.stages.some((stage) => stage.kind === "doubleElim" && stage.rumbleWeek === week);
}

// The matchup header's standings line, from the league's own standings
// (seed and record per its format).
export function standingsRows(data: SeasonData, state: PlayoffState): StandingsRow[] {
  const teamById = new Map(data.teams.map((team) => [team.teamId as string, team]));
  return state.standings.map((row) => {
    const team = teamById.get(row.teamId);
    return {
      teamId: row.teamId,
      name: team?.name ?? "Team",
      ...(team?.logoUrl ? { logoUrl: team.logoUrl } : {}),
      isSelf: team?.isMine ?? false,
      rank: row.seed,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
    };
  });
}
