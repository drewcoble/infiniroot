import type { ReactNode } from "react";
import { Box, Badge, Card, Group, Stack, Text } from "@mantine/core";
import { positionColorOrDefault } from "@shared/positionColors";
import { injuryColor } from "@shared/injuryColor";
import { RookieBadge } from "@shared/RookieBadge";
import type { RosVorRow } from "../types/season";

// Selected-card highlight color for the Trade tab's clickable cards (see
// selectable below) - a warm, unclaimed color (not red/orange/yellow/gray,
// already injuryColor's; not grape, RookieBadge's) picked directly rather
// than a Mantine theme color, since this is a one-off highlight, not a
// reusable semantic color like positionColors.ts's set.
const SELECTED_BACKGROUND = "rgba(139, 69, 19, 0.15)";
const SELECTED_BORDER = "saddlebrown";

interface PlayerCardProps {
  row: RosVorRow;
  isRookie: boolean;
  // Overrides the left-hand label (row.rosRank by default) - the Depth
  // Charts tab (src/routes/league/$leagueId/depthCharts.tsx) reuses this
  // card but wants the team's own depth-chart slot ("RB2") there instead of
  // this player's overall league-wide rosVOR rank, which isn't relevant
  // context once you're already looking at one team's roster.
  leftLabel?: string;
  // Renders the left-hand label as a colored Badge instead of leftLabel's
  // plain dimmed text - My Team (TeamRosterList.tsx) uses this for the
  // player's roster slot ("QB", "BN", ...), colored the same way the slot
  // badges elsewhere in the app are (positionColorOrDefault). Takes priority
  // over leftLabel/row.rosRank when set.
  leftBadge?: { label: string; color: string };
  // Hides the entire left-hand label area (leftBadge/leftLabel/row.rosRank
  // all ignored) - Trade's matchup rows already show the slot between the
  // two teams' cards (see TradeRosterMatchup.tsx), and the overall
  // league-wide rosVOR rank that'd otherwise show by default isn't
  // meaningful context there, just wasted width in an already-condensed
  // two-column view.
  showLeftLabel?: boolean;
  // Extra row rendered below the existing name/position/PPG content, still
  // inside the same card border - the Free Agents tab (freeAgents.tsx)
  // reuses this card but needs its own suggested-bid/rationale line, which
  // doesn't belong on every other consumer of this card.
  footer?: ReactNode;
  // Overrides the right-aligned PPG/ROS PPG stack - My Team shows this
  // week's Proj/Actual points instead (row.actualPpg/rosPpg are season-long
  // rates, not a single matchup's numbers). null hides the column entirely
  // rather than falling back to the default PPG stack - Trade's cards are
  // already half-width, so actualVOR/rosVOR move into footer instead (see
  // TradeRosterMatchup.tsx) to leave the name room instead of truncating it.
  rightStats?: ReactNode | null;
  // Makes the whole card clickable and highlights it (saddlebrown
  // background + border) when selected - only Trade's roster panels need
  // player selection. No separate checkbox - the entire card is the click
  // target, so the highlight is the only affordance.
  selectable?: { selected: boolean; onToggle: () => void };
  // Hides the rostered-by-team text (and its "FA" fallback badge) - Trade's
  // matchup rows already group cards by team, so repeating the team name (or
  // showing a nonsensical "FA" badge for an already-rostered player) is just
  // noise there.
  showRosteredBy?: boolean;
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
  leftBadge,
  showLeftLabel = true,
  footer,
  rightStats,
  selectable,
  showRosteredBy = true,
}: PlayerCardProps) {
  return (
    <Card
      withBorder
      padding="xs"
      radius="md"
      onClick={selectable?.onToggle}
      style={{
        ...(selectable ? { cursor: "pointer" } : {}),
        ...(selectable?.selected
          ? { backgroundColor: SELECTED_BACKGROUND, borderColor: SELECTED_BORDER }
          : {}),
      }}
    >
      <Group wrap="nowrap" gap="sm">
        {showLeftLabel &&
          (leftBadge ? (
            <Badge size="sm" variant="light" color={leftBadge.color}>
              {leftBadge.label}
            </Badge>
          ) : (
            <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
              {leftLabel ?? row.rosRank}
            </Text>
          ))}
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
            {showRosteredBy &&
              (row.rosteredByTeamName ? (
                <Text c="dimmed" size="xs" truncate>
                  {row.rosteredByTeamName}
                </Text>
              ) : (
                <Badge size="sm" variant="outline" color="gray">
                  FA
                </Badge>
              ))}
          </Group>
        </Stack>
        {rightStats !== null && (
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
        )}
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
