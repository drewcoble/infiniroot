import type { ReactNode } from "react";
import { Anchor, Badge, Card, Group, Stack, Text } from "@mantine/core";
import { Link } from "@tanstack/react-router";

interface TeamCardProps {
  leagueId: string;
  teamId: string;
  name: string;
  isSelf: boolean;
  // Left-hand label, vertically centered against the whole card same as
  // PlayerCard's rank column - StandingsList passes the win/loss rank,
  // PowerRankingsList passes this week's power-ranking position, since
  // those aren't necessarily the same number for a given team.
  leftLabel: ReactNode;
  // Rendered inline right after the team name/self badge - PowerRankingsList
  // uses this for its up/down-vs-last-week indicator, which doesn't apply to
  // StandingsList.
  nameSuffix?: ReactNode;
  // Right-aligned stat stack - shape differs entirely between the two lists
  // (record/PF-PA/waiver vs. a single projected-points figure), so this card
  // only owns the shared name/rank/link chrome, same division of concerns as
  // PlayerCard's row-specific stat stack.
  stats: ReactNode;
}

// Shared shell for infinileague's Standings and Power Rankings lists (see
// StandingsList.tsx/PowerRankingsList.tsx) - deliberately mirrors PlayerCard's
// layout (rank label left, flexible middle, stat stack right) so a team reads
// with the same visual weight a player does elsewhere in the app.
export function TeamCard({
  leagueId,
  teamId,
  name,
  isSelf,
  leftLabel,
  nameSuffix,
  stats,
}: TeamCardProps) {
  return (
    <Card withBorder padding="xs" radius="md">
      <Group wrap="nowrap" gap="sm">
        <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
          {leftLabel}
        </Text>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Link
              to="/league/$leagueId/teams/$teamId"
              params={{ leagueId, teamId }}
              style={{ textDecoration: "none" }}
            >
              <Anchor component="span" size="sm" fw={500} truncate>
                {name}
              </Anchor>
            </Link>
            {isSelf && (
              <Badge size="sm" variant="light">
                You
              </Badge>
            )}
            {nameSuffix}
          </Group>
        </Stack>
        <Stack gap={2} align="flex-end">
          {stats}
        </Stack>
      </Group>
    </Card>
  );
}
