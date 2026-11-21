import { Stack, Title } from "@mantine/core";
import { TournamentBracket, type BracketTeam } from "@shared/glass/TournamentBracket";
import classes from "@shared/glass/TournamentBracket.module.css";
import type { LeaguePlayoffs, StandingsRow } from "@shared/league/types/season";

// The league's playoff tournaments, one bracket each (just the championship
// for now). Before the bracket is set it's seeded from today's standings
// (or projected final ones) - see playoffs.ts's loadPlayoffs.
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
  const teams = new Map<string, BracketTeam>(
    standings.map((row) => [
      row.teamId,
      { name: row.name, logoUrl: row.logoUrl, isMine: row.isSelf },
    ]),
  );
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
                {playoffs.seeding === "projected"
                  ? "Seeded by projected final standings"
                  : "If the season ended today"}{" "}
                · starts week {playoffStartWeek}
              </div>
            )}
            <TournamentBracket
              tournament={tournament}
              teams={teams}
              currentWeek={playoffs.currentWeek}
            />
          </Stack>
        ),
      )}
    </Stack>
  );
}
