import { useLayoutEffect, useRef, type CSSProperties } from "react";
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
  const firstRoundSlots = layout[0]?.length ?? 1;
  const champion =
    tournament.championTeamId !== null ? standingByTeam.get(tournament.championTeamId) : undefined;

  // How far the viewer has swiped, in rounds (1.5 = halfway from round 2 to
  // round 3), written straight to the scroller as --progress on every
  // scroll frame - no re-render. The CSS spaces each round's spots by
  // 2^(round - progress), so the round in view stacks tight and every later
  // game stays level between its two feeders, all the way through a swipe.
  // Moved with transforms only, never resized, so it keeps up with the
  // finger. The bracket keeps round 1's height throughout, so the page
  // doesn't move up and down from round to round (resizing the scroller
  // mid-swipe also breaks Safari's scroll snap).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Array<HTMLDivElement | null>>([]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const lastIndex = tournament.rounds.length - 1;
    const step = () => {
      const [first, second] = columnRefs.current;
      return first && second ? second.offsetLeft - first.offsetLeft : 0;
    };
    const apply = () => {
      const width = step();
      const progress =
        width > 0 ? Math.min(Math.max(scroller.scrollLeft / width, 0), lastIndex) : 0;
      scroller.style.setProperty("--progress", String(progress));
    };
    const start = initialRound(tournament, currentWeek);
    scroller.scrollLeft = step() * start;
    apply();
    let pending = 0;
    const onScroll = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        apply();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(pending);
      scroller.removeEventListener("scroll", onScroll);
    };
    // Set up once per bracket - after that the viewer's swipes move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        style={{ "--first-round-slots": firstRoundSlots } as CSSProperties}
      >
        {tournament.rounds.map((round, r) => {
          const slots = layout[r] ?? [];
          const isLast = r === tournament.rounds.length - 1;
          const pairs = Array.from({ length: Math.ceil(slots.length / 2) }, (_, q) => q);
          return (
            <div
              key={round.round}
              ref={(element) => {
                columnRefs.current[r] = element;
              }}
              className={classes.column}
              style={{ "--r": r } as CSSProperties}
              aria-label={round.name}
            >
              <div className={`${glass.sectionLabel} ${classes.columnLabel}`}>
                {round.name} · {weeksLabel(round.weeks)}
              </div>
              <div className={classes.track}>
                {slots.map((slot, p) =>
                  slot ? (
                    <div
                      key={slot.kind === "game" ? slot.game.id : `bye-${p}`}
                      className={classes.slot}
                      style={{ "--c": p + 0.5 } as CSSProperties}
                    >
                      {slot.kind === "bye" ? (
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
                      ) : (
                        <div className={`${glass.card} ${classes.game}`}>
                          {slot.game.entrants.map((entrant, index) => (
                            <EntrantRow
                              key={index}
                              entrant={entrant}
                              game={slot.game}
                              standingByTeam={standingByTeam}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null,
                )}
                {/* Each pair's connector: out of both spots, joined in the
                    gap, on into the next round's game level between them. */}
                {!isLast &&
                  pairs.map((q) => (
                    <div
                      key={q}
                      className={classes.join}
                      style={{ "--c": 2 * q + 0.5 } as CSSProperties}
                    >
                      {slots[2 * q] && <span className={classes.joinTop} />}
                      {slots[2 * q + 1] && <span className={classes.joinBottom} />}
                      <span className={classes.joinVertical} />
                      <span className={classes.joinInto} />
                    </div>
                  ))}
              </div>
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
