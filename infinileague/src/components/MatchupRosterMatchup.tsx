import type { ReactNode } from "react";
import { Badge, Box, Card, Group, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { PlayerCard } from "@shared/PlayerCard";
import type { RosVorRow, SlotLabel, TeamRosterRow } from "../types/season";
import {
  formatGameLine,
  isGameInProgress,
  liveProjection,
  remainingFraction,
  type WeekGame,
} from "../lib/liveGames";

interface MatchupRosterMatchupProps {
  teamARows: TeamRosterRow[];
  // undefined covers both "opponent not known yet" and "their roster is
  // still loading" - either way every row on the right falls back to a
  // blank placeholder card, same convention TradeRosterMatchup uses.
  teamBRows: TeamRosterRow[] | undefined;
  teamAName: string;
  teamBName: string;
  // This week's games by NFL team (see lib/liveGames.ts) - undefined while
  // loading, in which case cards fall back to the plain team/bye line.
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
}

function slotLabel(slot: SlotLabel | undefined): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(2);
}

// Excludes IR/TAXI (not part of this week's scored lineup either way) but
// keeps unfilled slots, same as TradeRosterMatchup - an empty bench spot on
// one side still needs a row so the two teams' slots line up index-for-index.
function alignableRows(rows: TeamRosterRow[]): TeamRosterRow[] {
  return rows.filter((row) => row.slot !== undefined && row.slot !== "IR" && row.slot !== "TAXI");
}

// "HOU · vs. LAR · Sun 1:00 PM" / "HOU · @ IND · Q3 8:12" / "HOU · BYE" -
// this week's game rather than the season bye week other tabs show. Falls
// back to that season-bye line until the week's slate has loaded (or if it
// was never synced - an empty slate would otherwise mark everyone BYE).
function teamLine(row: TeamRosterRow, gamesByTeam: Map<string, WeekGame> | undefined, now: number): string | null {
  if (!gamesByTeam || gamesByTeam.size === 0 || !row.team) {
    return row.byeWeek !== undefined ? `${row.team ?? ""} · Bye ${row.byeWeek}` : (row.team ?? null);
  }
  const game = gamesByTeam.get(row.team);
  return game ? `${row.team} · ${formatGameLine(game, now)}` : `${row.team} · BYE`;
}

// A filled roster row has no rosVOR fields of its own here (this is a
// weekly matchup roster, not the Players tab's league-wide value board) -
// same zeroed-stand-in convention TeamRosterList.tsx's toRosVorRow uses.
function toRosVorRow(row: TeamRosterRow, teamName: string, team: string | null): RosVorRow {
  return {
    fpid: row.fpid ?? 0,
    name: row.name ?? "",
    team,
    position: row.position ?? "QB",
    rosVor: 0,
    rosRank: 0,
    actualVor: 0,
    actualRank: 0,
    positionRank: 0,
    rosPpg: 0,
    actualPpg: 0,
    weekVor: 0,
    weekRank: 0,
    weekPpg: 0,
    weekPositionRank: 0,
    rosteredByTeamName: teamName,
    ...(row.injury ? { injury: row.injury } : {}),
  };
}

// Same wrapper both TradeRosterMatchup and this component render every row
// cell into - flex: 1/minWidth: 0 for an even width split, grid so the card
// stretches to match whichever side of the row is taller.
function Cell({ children }: { children: ReactNode }) {
  return <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>{children}</Box>;
}

function PlaceholderCard({ empty }: { empty?: boolean }) {
  return (
    <Card padding="xs" radius="md" style={{ minHeight: 44 }}>
      {!empty && (
        <Text size="sm" c="dimmed">
          —
        </Text>
      )}
    </Card>
  );
}

function PlayerCell({
  row,
  teamName,
  gamesByTeam,
  now,
}: {
  row: TeamRosterRow | undefined;
  teamName: string;
  gamesByTeam: Map<string, WeekGame> | undefined;
  now: number;
}) {
  if (row === undefined || row.fpid === undefined) {
    return (
      <Cell>
        <PlaceholderCard empty={row === undefined} />
      </Cell>
    );
  }
  // While their game is on, the left stat is the live projection (points
  // so far + the unplayed share of the projection) instead of the pregame
  // one - before kickoff and after the final, the pregame projection is
  // the more useful reference.
  const game = row.team ? gamesByTeam?.get(row.team) : undefined;
  const inProgress = isGameInProgress(game, now);
  const leftLabel = inProgress ? "Live" : "Proj";
  const leftPoints = inProgress
    ? liveProjection(row.projectedPoints, row.actualPoints, remainingFraction(game, now))
    : row.projectedPoints;
  return (
    <Cell>
      <PlayerCard
        row={toRosVorRow(row, teamName, teamLine(row, gamesByTeam, now))}
        live={inProgress}
        isRookie={row.isRookie ?? false}
        showLeftLabel={false}
        // showRosteredBy off (every card in a column is already known to
        // belong to that team - see the header above) and rightStats off in
        // favor of footer below - same "half-width card, stats don't fit
        // beside the name" tradeoff TradeRosterMatchup already makes, so
        // name/team keep the row's full width instead of getting squeezed
        // and wrapping.
        showRosteredBy={false}
        rightStats={null}
        footer={
          <Group justify="space-between" wrap="nowrap" gap={4}>
            <Text size="xs" c="dimmed">
              <Text span {...(inProgress ? { c: "green", fw: 600 } : {})}>
                {leftLabel}
              </Text>{" "}
              <Text span fw={600} c="var(--mantine-color-text)">{formatPoints(leftPoints)}</Text>
            </Text>
            <Text size="xs" c="dimmed">
              Actual <Text span fw={600} c="var(--mantine-color-text)">{formatPoints(row.actualPoints)}</Text>
            </Text>
          </Group>
        }
      />
    </Cell>
  );
}

// Read-only counterpart to TradeRosterMatchup - both teams' rosters lined up
// by roster slot for this week's matchup, slot badge between the two
// columns. No selection here (this is "who am I playing," not a trade
// builder), and each card shows this week's Proj/Actual points instead of
// season-long VOR, since that's the number a matchup view is actually about.
export function MatchupRosterMatchup({
  teamARows,
  teamBRows,
  teamAName,
  teamBName,
  gamesByTeam,
  now,
}: MatchupRosterMatchupProps) {
  const aRows = alignableRows(teamARows);
  const bRows = teamBRows ? alignableRows(teamBRows) : undefined;
  const rowCount = Math.max(aRows.length, bRows?.length ?? 0);

  return (
    <>
      {Array.from({ length: rowCount }, (_, index) => {
        const aRow = aRows[index];
        const bRow = bRows?.[index];
        const slot = aRow?.slot ?? bRow?.slot;
        return (
          <Group key={index} wrap="nowrap" gap="xs" align="stretch">
            <PlayerCell row={aRow} teamName={teamAName} gamesByTeam={gamesByTeam} now={now} />
            <Badge
              size="sm"
              variant="light"
              color={positionColorOrDefault(slot ?? "")}
              style={{ flexShrink: 0, minWidth: 50, alignSelf: "center" }}
            >
              {slotLabel(slot)}
            </Badge>
            {bRows ? (
              <PlayerCell row={bRow} teamName={teamBName} gamesByTeam={gamesByTeam} now={now} />
            ) : (
              <Cell>
                <PlaceholderCard empty />
              </Cell>
            )}
          </Group>
        );
      })}
    </>
  );
}
