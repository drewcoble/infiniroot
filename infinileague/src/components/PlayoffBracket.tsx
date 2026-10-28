import { Stack, Title } from "@mantine/core";
import { Trophy } from "lucide-react";
import { TeamLogo } from "./cards/TeamLogo";
import { rankPillStyle } from "./cards/cardShared";
import glass from "./cards/GlassMatchupCard.module.css";
import classes from "./PlayoffBracket.module.css";
import type {
  LeaguePlayoffs,
  StandingsRow,
  Tournament,
  TournamentEntrant,
  TournamentGame,
} from "../types/season";

function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return "";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks[0]}-${weeks[weeks.length - 1]}`;
}

function EntrantRow({
  entrant,
  game,
  gamesById,
  standingByTeam,
}: {
  entrant: TournamentEntrant;
  game: TournamentGame;
  gamesById: Map<string, TournamentGame>;
  standingByTeam: Map<string, StandingsRow>;
}) {
  const standing = entrant.teamId !== null ? standingByTeam.get(entrant.teamId) : undefined;
  if (entrant.teamId === null || !standing) {
    // "Winner of A / B" while the feeder game's teams are known.
    const feeder = entrant.fromGameId !== null ? gamesById.get(entrant.fromGameId) : undefined;
    const feederNames = feeder?.entrants.map((e) =>
      e.teamId !== null ? standingByTeam.get(e.teamId)?.name : undefined,
    );
    const label =
      feederNames && feederNames.every(Boolean) ? `Winner of ${feederNames.join(" / ")}` : "TBD";
    return (
      <div className={`${classes.entrant} ${classes.tbd}`}>
        <span className={classes.name}>{label}</span>
      </div>
    );
  }
  const outcome =
    game.winnerTeamId === null ? "" : game.winnerTeamId === entrant.teamId ? classes.winner : classes.loser;
  return (
    <div className={`${classes.entrant} ${outcome}`}>
      {entrant.seed !== null && (
        <span className={`${glass.pill} ${classes.seed}`} style={rankPillStyle(standing.isSelf)}>
          {entrant.seed}
        </span>
      )}
      <TeamLogo name={standing.name} logoUrl={standing.logoUrl} size={22} />
      <span className={classes.name}>{standing.name}</span>
      {entrant.points !== null && <span className={classes.points}>{entrant.points.toFixed(2)}</span>}
    </div>
  );
}

function TournamentBracket({
  tournament,
  standingByTeam,
}: {
  tournament: Tournament;
  standingByTeam: Map<string, StandingsRow>;
}) {
  const gamesById = new Map(
    tournament.rounds.flatMap((round) => round.games.map((game) => [game.id, game] as const)),
  );
  const champion =
    tournament.championTeamId !== null ? standingByTeam.get(tournament.championTeamId) : undefined;
  return (
    <Stack gap="md">
      {champion && (
        <div className={`${glass.card} ${classes.champion}`}>
          <Trophy size={26} color="#facc15" />
          <TeamLogo name={champion.name} logoUrl={champion.logoUrl} size={32} />
          <div style={{ minWidth: 0 }}>
            <div className={glass.sectionLabel}>Champion</div>
            <div className={classes.championName}>{champion.name}</div>
          </div>
        </div>
      )}
      {/* Final last, same order the rounds are played in. */}
      {tournament.rounds.map((round) => (
        <div key={round.round} className={classes.round}>
          <div className={glass.sectionLabel}>
            {round.name} · {weeksLabel(round.weeks)}
          </div>
          {round.games.map((game) => (
            <div key={game.id} className={`${glass.card} ${classes.game}`}>
              {game.entrants.map((entrant, slot) => (
                <EntrantRow
                  key={slot}
                  entrant={entrant}
                  game={game}
                  gamesById={gamesById}
                  standingByTeam={standingByTeam}
                />
              ))}
            </div>
          ))}
        </div>
      ))}
    </Stack>
  );
}

// The league's playoff tournaments, one bracket each (just the championship
// for now). Before the bracket is set it's either Sleeper's projection from
// today's standings, or a note on when it will be.
export function PlayoffBracket({
  playoffs,
  standings,
}: {
  playoffs: LeaguePlayoffs;
  standings: StandingsRow[];
}) {
  if (!playoffs.hasPlayoffs) {
    return <div className={classes.note}>This league has no playoffs.</div>;
  }
  const standingByTeam = new Map(standings.map((row) => [row.teamId, row]));
  const playoffStartWeek = playoffs.regularSeasonEndWeek + 1;
  return (
    <Stack gap="lg">
      {playoffs.tournaments.map((tournament) =>
        tournament.rounds.length === 0 ? (
          <div key={tournament.kind} className={classes.note}>
            Bracket is set after week {playoffs.regularSeasonEndWeek}.
          </div>
        ) : (
          <Stack key={tournament.kind} gap="sm">
            {playoffs.tournaments.length > 1 && (
              <Title order={4}>{tournament.name}</Title>
            )}
            {playoffs.phase === "regular" && (
              <div className={classes.note}>
                Projected from today&apos;s standings · starts week {playoffStartWeek}
              </div>
            )}
            <TournamentBracket tournament={tournament} standingByTeam={standingByTeam} />
          </Stack>
        ),
      )}
    </Stack>
  );
}
