import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  standingByTeam,
  note,
}: {
  entrant: TournamentEntrant;
  game: TournamentGame;
  // Stands in for points, e.g. "Bye".
  note?: string;
  standingByTeam: Map<string, StandingsRow>;
}) {
  const standing = entrant.teamId !== null ? standingByTeam.get(entrant.teamId) : undefined;
  if (entrant.teamId === null || !standing) {
    return (
      <div className={`${classes.entrant} ${classes.tbd}`}>
        <span className={classes.name}>TBD</span>
      </div>
    );
  }
  const outcome =
    game.winnerTeamId === null
      ? ""
      : game.winnerTeamId === entrant.teamId
        ? classes.winner
        : classes.loser;
  return (
    <div className={`${classes.entrant} ${outcome}`}>
      {entrant.seed !== null && (
        <span className={`${glass.pill} ${classes.seed}`} style={rankPillStyle(standing.isSelf)}>
          {entrant.seed}
        </span>
      )}
      <TeamLogo name={standing.name} logoUrl={standing.logoUrl} size={22} />
      <span className={classes.name}>{standing.name}</span>
      {note !== undefined ? (
        <span className={classes.byeNote}>{note}</span>
      ) : (
        entrant.points !== null && (
          <span className={classes.points}>{entrant.points.toFixed(2)}</span>
        )
      )}
    </div>
  );
}

// Each round's games by bracket position, the final at the root: a game
// in position p of round r is fed by positions 2p and 2p + 1 of round r - 1,
// so it sits level between them. A spot with no feeder (a bye) leaves that
// position to that team's bye. Any game the feeder links miss fills the
// first gaps.
type BracketSlot =
  | { kind: "game"; game: TournamentGame }
  | { kind: "bye"; entrant: TournamentEntrant }
  | null;

function layoutRounds(
  tournament: Tournament,
  gamesById: Map<string, TournamentGame>,
): BracketSlot[][] {
  const { rounds } = tournament;
  const layout: BracketSlot[][] = rounds.map(() => []);
  layout[rounds.length - 1] = rounds[rounds.length - 1]!.games.map((game) => ({
    kind: "game",
    game,
  }));
  for (let r = rounds.length - 1; r > 0; r--) {
    const previousIds = new Set(rounds[r - 1]!.games.map((game) => game.id));
    const slots: BracketSlot[] = layout[r]!.flatMap((slot): BracketSlot[] => {
      if (slot?.kind !== "game") return [null, null];
      return slot.game.entrants.map((entrant): BracketSlot => {
        const feeder =
          entrant.fromGameId !== null && previousIds.has(entrant.fromGameId)
            ? gamesById.get(entrant.fromGameId)
            : undefined;
        if (feeder) return { kind: "game", game: feeder };
        return entrant.teamId !== null ? { kind: "bye", entrant } : null;
      });
    });
    const placed = new Set(slots.flatMap((slot) => (slot?.kind === "game" ? [slot.game.id] : [])));
    for (const game of rounds[r - 1]!.games) {
      if (placed.has(game.id)) continue;
      const gap = slots.findIndex((slot) => slot?.kind !== "game");
      if (gap === -1) slots.push({ kind: "game", game });
      else slots[gap] = { kind: "game", game };
    }
    layout[r - 1] = slots;
  }
  return layout;
}

// Which round the viewer starts on: the one being played (or next up), the
// final once it's over.
function initialRound(tournament: Tournament, currentWeek: number): number {
  const index = tournament.rounds.findIndex(
    (round) => (round.weeks[round.weeks.length - 1] ?? 0) >= currentWeek,
  );
  return index === -1 ? tournament.rounds.length - 1 : index;
}

function TournamentBracket({
  tournament,
  standingByTeam,
  currentWeek,
}: {
  tournament: Tournament;
  standingByTeam: Map<string, StandingsRow>;
  currentWeek: number;
}) {
  const gamesById = new Map(
    tournament.rounds.flatMap((round) => round.games.map((game) => [game.id, game] as const)),
  );
  const layout = layoutRounds(tournament, gamesById);
  const champion =
    tournament.championTeamId !== null ? standingByTeam.get(tournament.championTeamId) : undefined;

  // The round snapped into view. Its games stack tight; each later round's
  // spots double in height per round, so every game stays level between its
  // two feeders.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [focused, setFocused] = useState(() => initialRound(tournament, currentWeek));

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const column = columnRefs.current[focused];
    if (scroller && column) scroller.scrollLeft = column.offsetLeft - scroller.offsetLeft;
    // Only on mount - after that the viewer's swipes move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const left = scroller.scrollLeft + scroller.offsetLeft;
    let nearest = 0;
    columnRefs.current.forEach((column, index) => {
      const best = columnRefs.current[nearest];
      if (column && best && Math.abs(column.offsetLeft - left) < Math.abs(best.offsetLeft - left)) {
        nearest = index;
      }
    });
    if (nearest !== focused) setFocused(nearest);
  };

  const focusedSlots = layout[focused]?.length ?? 1;
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
      <div
        ref={scrollerRef}
        className={classes.scroller}
        onScroll={onScroll}
        style={{ "--focused-slots": focusedSlots } as CSSProperties}
      >
        {tournament.rounds.map((round, r) => {
          const slots = layout[r] ?? [];
          const isLast = r === tournament.rounds.length - 1;
          return (
            <div
              key={round.round}
              ref={(element) => {
                columnRefs.current[r] = element;
              }}
              className={classes.column}
              aria-label={round.name}
            >
              <div className={`${glass.sectionLabel} ${classes.columnLabel}`}>
                {round.name} · {weeksLabel(round.weeks)}
              </div>
              {slots.map((slot, p) => {
                const game = slot?.kind === "game" ? slot.game : null;
                // Always an elbow to the gap's middle - that's where the
                // next game sits, a bye on the other side or not.
                const connector =
                  isLast || !slot ? "" : p % 2 === 0 ? classes.joinDown : classes.joinUp;
                const fed = game !== null && r > 0 && layout[r - 1]!.length > 0;
                return (
                  <div
                    key={game?.id ?? `${slot?.kind ?? "empty"}-${p}`}
                    className={`${classes.slot} ${connector} ${fed ? classes.fed : ""}`}
                    // Spots grow by doubling per round past the focused
                    // one (earlier rounds are off to the left).
                    style={{ "--span": 2 ** Math.max(0, r - focused) } as CSSProperties}
                  >
                    {slot?.kind === "bye" && (
                      <div className={`${glass.card} ${classes.game} ${classes.bye}`}>
                        <EntrantRow
                          entrant={slot.entrant}
                          game={{
                            id: "bye",
                            entrants: [slot.entrant, slot.entrant],
                            winnerTeamId: null,
                          }}
                          standingByTeam={standingByTeam}
                          note="Bye"
                        />
                      </div>
                    )}
                    {game && (
                      <div className={`${glass.card} ${classes.game}`}>
                        {game.entrants.map((entrant, slot) => (
                          <EntrantRow
                            key={slot}
                            entrant={entrant}
                            game={game}
                            standingByTeam={standingByTeam}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Stack>
  );
}

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
                {playoffs.seeding === "projected"
                  ? "Seeded by projected final standings"
                  : "If the season ended today"}{" "}
                · starts week {playoffStartWeek}
              </div>
            )}
            <TournamentBracket
              tournament={tournament}
              standingByTeam={standingByTeam}
              currentWeek={playoffs.currentWeek}
            />
          </Stack>
        ),
      )}
    </Stack>
  );
}
