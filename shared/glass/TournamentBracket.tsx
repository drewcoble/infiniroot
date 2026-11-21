import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { Stack } from "@mantine/core";
import { Trophy } from "lucide-react";
import { TeamLogo } from "./TeamLogo";
import { rankPillStyle } from "./pills";
import glass from "./GlassMatchupCard.module.css";
import classes from "./TournamentBracket.module.css";

// A single-elimination bracket in the glass style - swipe round to round,
// each later game level between its two feeders. Shared by infinileague's
// platform playoffs and infiniyoffs' brackets.

export interface BracketEntrant {
  // Null until known (TBD).
  teamId: string | null;
  seed: number | null;
  // Null before the round starts.
  points: number | null;
  // The earlier game this spot is fed by - null for a team that starts in
  // this round (round 1, or off a bye).
  fromGameId: string | null;
  // What a team with no feeder game shows in the earlier round's column -
  // "Bye" unless said otherwise (e.g. a double elimination's "From WB").
  note?: string | undefined;
}

export interface BracketGame {
  id: string;
  entrants: [BracketEntrant, BracketEntrant];
  winnerTeamId: string | null;
}

export interface BracketRound {
  round: number;
  name: string;
  weeks: number[];
  games: BracketGame[];
}

export interface BracketTournament {
  rounds: BracketRound[];
  championTeamId: string | null;
}

// A column after the bracket's rounds, outside the bracket's game tree -
// a double elimination's Royal Rumble (any number of teams in one game)
// and final. No connector lines into it.
export interface BracketExtraColumn {
  key: string;
  name: string;
  weeks: number[];
  games: { id: string; entrants: BracketEntrant[]; winnerTeamId: string | null }[];
  // A line under the column's games.
  caption?: string | undefined;
}

// Brackets that swipe together (a double elimination's winners and
// losers): whichever one the viewer touches leads and snaps; the rest
// follow its scroll position, snapping off. Their columns must line up -
// same count, same weeks.
export interface BracketSync {
  members: Set<{ scroller: HTMLDivElement; apply: () => void }>;
  leader: HTMLDivElement | null;
}

export function createBracketSync(): BracketSync {
  return { members: new Set(), leader: null };
}

export interface BracketTeam {
  name: string;
  logoUrl?: string | undefined;
  isMine: boolean;
}

function weeksLabel(weeks: number[]): string {
  if (weeks.length === 0) return "";
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks[0]}-${weeks[weeks.length - 1]}`;
}

function EntrantRow({
  entrant,
  game,
  teams,
  note,
}: {
  entrant: BracketEntrant;
  game: Pick<BracketGame, "winnerTeamId">;
  // Stands in for points, e.g. "Bye".
  note?: string;
  teams: ReadonlyMap<string, BracketTeam>;
}) {
  const standing = entrant.teamId !== null ? teams.get(entrant.teamId) : undefined;
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
        <span className={`${glass.pill} ${classes.seed}`} style={rankPillStyle(standing.isMine)}>
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
  | { kind: "game"; game: BracketGame }
  | { kind: "bye"; entrant: BracketEntrant }
  | null;

function layoutRounds(
  tournament: BracketTournament,
  gamesById: Map<string, BracketGame>,
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
function initialRound(columns: Array<{ weeks: number[] }>, currentWeek: number): number {
  const index = columns.findIndex(
    (column) => (column.weeks[column.weeks.length - 1] ?? 0) >= currentWeek,
  );
  return index === -1 ? columns.length - 1 : index;
}

export function TournamentBracket({
  tournament,
  teams,
  currentWeek,
  leadingColumns = [],
  extraColumns = [],
  sync,
}: {
  tournament: BracketTournament;
  teams: ReadonlyMap<string, BracketTeam>;
  currentWeek: number;
  // Columns before round 1 - weeks this bracket sits out, so it lines up
  // with a synced one.
  leadingColumns?: BracketExtraColumn[];
  extraColumns?: BracketExtraColumn[];
  sync?: BracketSync | undefined;
}) {
  const lead = leadingColumns.length;
  const gamesById = new Map(
    tournament.rounds.flatMap((round) => round.games.map((game) => [game.id, game] as const)),
  );
  const layout = layoutRounds(tournament, gamesById);
  const firstRoundSlots = layout[0]?.length ?? 1;
  const champion =
    tournament.championTeamId !== null ? teams.get(tournament.championTeamId) : undefined;

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
    const lastIndex = lead + tournament.rounds.length + extraColumns.length - 1;
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
    const start = initialRound(
      [...leadingColumns, ...tournament.rounds, ...extraColumns],
      currentWeek,
    );
    scroller.scrollLeft = step() * start;
    apply();
    const member = { scroller, apply };
    sync?.members.add(member);
    // The touched bracket leads: it snaps, the others follow unsnapped.
    const takeLead = () => {
      if (!sync || sync.leader === scroller) return;
      sync.leader = scroller;
      for (const other of sync.members) {
        other.scroller.style.scrollSnapType = other.scroller === scroller ? "" : "none";
      }
    };
    let pending = 0;
    const onScroll = () => {
      if (sync?.leader === scroller) {
        for (const other of sync.members) {
          if (other.scroller === scroller) continue;
          other.scroller.scrollLeft = scroller.scrollLeft;
        }
      }
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        apply();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerdown", takeLead, { passive: true });
    scroller.addEventListener("touchstart", takeLead, { passive: true });
    scroller.addEventListener("wheel", takeLead, { passive: true });
    return () => {
      cancelAnimationFrame(pending);
      sync?.members.delete(member);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", takeLead);
      scroller.removeEventListener("touchstart", takeLead);
      scroller.removeEventListener("wheel", takeLead);
    };
    // Set up once per bracket - after that the viewer's swipes move it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A column outside the game tree (leading or trailing) at column index r.
  const renderExtra = (column: BracketExtraColumn, r: number) => (
    <div
      key={column.key}
      ref={(element) => {
        columnRefs.current[r] = element;
      }}
      className={classes.column}
      style={{ "--r": r } as CSSProperties}
      aria-label={column.name}
    >
      <div className={`${glass.sectionLabel} ${classes.columnLabel}`}>
        {column.name} · {weeksLabel(column.weeks)}
      </div>
      <div className={`${classes.track} ${classes.extraTrack}`}>
        {column.games.map((game) => (
          <div key={game.id} className={`${glass.card} ${classes.game}`}>
            {game.entrants.map((entrant, index) => (
              <EntrantRow
                key={index}
                entrant={entrant}
                game={game}
                teams={teams}
                {...(entrant.note !== undefined ? { note: entrant.note } : {})}
              />
            ))}
          </div>
        ))}
        {column.caption && <div className={classes.note}>{column.caption}</div>}
      </div>
    </div>
  );

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
        {leadingColumns.map((column, i) => renderExtra(column, i))}
        {tournament.rounds.map((round, r) => {
          const slots = layout[r] ?? [];
          const isLast = r === tournament.rounds.length - 1;
          const pairs = Array.from({ length: Math.ceil(slots.length / 2) }, (_, q) => q);
          return (
            <div
              key={round.round}
              ref={(element) => {
                columnRefs.current[lead + r] = element;
              }}
              className={classes.column}
              style={{ "--r": lead + r } as CSSProperties}
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
                            game={{ winnerTeamId: null }}
                            teams={teams}
                            note={slot.entrant.note ?? "Bye"}
                          />
                        </div>
                      ) : (
                        <div className={`${glass.card} ${classes.game}`}>
                          {slot.game.entrants.map((entrant, index) => (
                            <EntrantRow
                              key={index}
                              entrant={entrant}
                              game={slot.game}
                              teams={teams}
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
        {extraColumns.map((column, i) =>
          renderExtra(column, lead + tournament.rounds.length + i),
        )}
      </div>
    </Stack>
  );
}
