import { Card, Group, Stack, Text } from "@mantine/core";
import { PlayerCard } from "./PlayerCard";
import type { RosVorRow, SlotLabel, TeamRosterRow } from "../types/season";

interface TeamRosterListProps {
  rows: TeamRosterRow[];
  // Shown as this player's "rostered by" line on their card - already true
  // by construction (every row here comes from this one team's roster), but
  // RosVorRow's own field still needs a value rather than null (which would
  // render PlayerCard's "FA" badge instead).
  teamName: string;
}

function slotLabel(slot: SlotLabel | undefined): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "TAXI") return "Taxi";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

function formatPoints(points: number | undefined): string {
  return points === undefined ? "—" : points.toFixed(1);
}

// A filled roster row has no rosVOR fields of its own (this is a weekly
// matchup roster, not the Players tab's league-wide value board) - a
// minimal stand-in RosVorRow, same "zero the fields PlayerCard doesn't use
// here" convention freeAgents.tsx's no-rosVOR-match fallback already
// established, so this player still reads through the one shared card
// rather than a second bespoke layout.
function toRosVorRow(row: TeamRosterRow, teamName: string): RosVorRow {
  return {
    fpid: row.fpid ?? 0,
    name: row.name ?? "",
    team: row.byeWeek !== undefined ? `${row.team ?? ""} · Bye ${row.byeWeek}` : (row.team ?? null),
    position: row.position ?? "QB",
    rosVor: 0,
    rosRank: 0,
    actualVor: 0,
    actualRank: 0,
    positionRank: 0,
    rosPpg: 0,
    actualPpg: 0,
    rosteredByTeamName: teamName,
    ...(row.injury ? { injury: row.injury } : {}),
  };
}

// One team's roster for a given week - the "My Team" page's replacement for
// its old plain Table, now the same PlayerCard every other player list in
// the app uses (see PlayerCard.tsx's own comment on why). Rows arrive
// pre-sorted from the backend in infinidraft's own canonical slot order (QB,
// SUPERFLEX, RB, WR, FLEX, TE, DST, K, BENCH, IR, TAXI - see convex/season/
// teamRoster.ts's SLOT_ORDER_RANK), rendered as-is. A row with no fpid is an
// unfilled slot (an open bench/taxi spot the league is configured for) -
// too sparse for a full PlayerCard, so it stays a minimal one-line stand-in.
export function TeamRosterList({ rows, teamName }: TeamRosterListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row, index) =>
        row.fpid !== undefined ? (
          <PlayerCard
            key={row.fpid}
            row={toRosVorRow(row, teamName)}
            isRookie={row.isRookie ?? false}
            leftLabel={slotLabel(row.slot)}
            rightStats={
              <>
                <Text size="xs" c="dimmed">
                  {formatPoints(row.projectedPoints)} Proj
                </Text>
                <Text size="xs" c="dimmed">
                  {formatPoints(row.actualPoints)} Actual
                </Text>
              </>
            }
          />
        ) : (
          <Card key={`empty-${row.slot}-${index}`} withBorder padding="xs" radius="md">
            <Group wrap="nowrap" gap="sm">
              <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
                {slotLabel(row.slot)}
              </Text>
              <Text size="sm" c="dimmed">
                —
              </Text>
            </Group>
          </Card>
        ),
      )}
    </Stack>
  );
}
