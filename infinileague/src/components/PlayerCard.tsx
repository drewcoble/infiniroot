import type { ReactNode } from "react";
import { Box, Badge, Card, Checkbox, Group, Stack, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { injuryColor } from "@shared/injuryColor";
import { RookieBadge } from "@shared/RookieBadge";
import type { RosVorRow } from "../types/season";

interface PlayerCardProps {
  row: RosVorRow;
  isRookie: boolean;
  // Overrides the left-hand label (row.rosRank by default) - the Depth
  // Charts tab (src/routes/league/$leagueId/depthCharts.tsx) reuses this
  // card but wants the team's own depth-chart slot ("RB2") there instead of
  // this player's overall league-wide rosVOR rank, which isn't relevant
  // context once you're already looking at one team's roster. My Team
  // (TeamRosterList.tsx) and Trade (TradeRosterPanel.tsx) reuse it the same
  // way for this player's roster slot ("QB", "BN", ...).
  leftLabel?: string;
  // Extra row rendered below the existing name/position/PPG content, still
  // inside the same card border - the Free Agents tab (freeAgents.tsx)
  // reuses this card but needs its own suggested-bid/rationale line, which
  // doesn't belong on every other consumer of this card.
  footer?: ReactNode;
  // Overrides the right-aligned PPG/ROS PPG stack - My Team shows this
  // week's Proj/Actual points instead (row.actualPpg/rosPpg are season-long
  // rates, not a single matchup's numbers) and Trade shows this player's VOR
  // value (the trade math's actual currency, see src/lib/tradeAnalyzer.ts).
  rightStats?: ReactNode;
  // Renders a checkbox before leftLabel and makes the whole card clickable -
  // only Trade's roster panels need player selection. onClick stops
  // propagation on the checkbox itself so clicking it doesn't toggle twice
  // (once from the checkbox's own onChange, once from the card's onClick).
  checkbox?: { checked: boolean; onChange: () => void };
}

// One row of infinileague's Players tab (src/routes/league/$leagueId/
// players.tsx) - deliberately spare rather than a dense stat table, since
// the tab's whole point is scanning hundreds of players at a glance. Rank
// stays vertically centered against the whole card (Group's default
// align="center") while the name/position/team/PPG detail stacks into two
// rows. Fixed height so the virtualizer driving that list can size it
// exactly (see PLAYER_CARD_HEIGHT there) - if this card's rendered height
// ever changes, that constant needs to move with it.
export function PlayerCard({
  row,
  isRookie,
  leftLabel,
  footer,
  rightStats,
  checkbox,
}: PlayerCardProps) {
  return (
    <Card
      withBorder
      padding="xs"
      radius="md"
      onClick={checkbox?.onChange}
      style={checkbox ? { cursor: "pointer" } : undefined}
    >
      <Group wrap="nowrap" gap="sm">
        {checkbox && (
          <Checkbox
            checked={checkbox.checked}
            onChange={checkbox.onChange}
            onClick={(event) => event.stopPropagation()}
          />
        )}
        <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
          {leftLabel ?? row.rosRank}
        </Text>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" fw={500} truncate>
              {row.name}
            </Text>
            {isRookie && <RookieBadge />}
            {row.injury && (
              <Badge color={injuryColor(row.injury.status)} size="sm" variant="light">
                {row.injury.statusShort}
              </Badge>
            )}
          </Group>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Badge size="sm" color={positionColorOrDefault(row.position)} variant="light">
              {row.position}
              {/* 0 is a "rank unknown, don't fabricate one" sentinel (see
                  freeAgents.tsx's no-rosVOR-match fallback) - every real
                  rank starts at 1, so this never hides a genuine #0. */}
              {row.positionRank > 0 ? row.positionRank : ""}
            </Badge>
            {row.team && (
              <Text c="dimmed" size="xs">
                {row.team}
              </Text>
            )}
            {row.rosteredByTeamName ? (
              <Text c="dimmed" size="xs" truncate>
                {row.rosteredByTeamName}
              </Text>
            ) : (
              <Badge size="sm" variant="outline" color="gray">
                FA
              </Badge>
            )}
          </Group>
        </Stack>
        <Stack gap={2} align="flex-end">
          {rightStats ?? (
            <>
              <Text size="xs" c="dimmed">
                {row.actualPpg.toFixed(1)} PPG
              </Text>
              <Text size="xs" c="dimmed">
                {row.rosPpg.toFixed(1)} ROS PPG
              </Text>
            </>
          )}
        </Stack>
      </Group>
      {footer && (
        <Box
          mt={6}
          pt={6}
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          {footer}
        </Box>
      )}
    </Card>
  );
}
