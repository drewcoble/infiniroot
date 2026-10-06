import { createFileRoute } from "@tanstack/react-router";
import { Box, Group, Stack, Text, Title } from "@mantine/core";
import {
  EmptyGlassCard,
  GlassMatchupCard,
  GlassSlotChip,
  type GlassMatchupCardData,
} from "../../../components/cards/GlassMatchupCard";
import { meterScaleMax } from "../../../components/cards/meterScale";
import { buildShortNames } from "../../../lib/shortPlayerName";

export const Route = createFileRoute("/league/$leagueId/cards")({
  component: CardsPage,
});

// Design sandbox for the player-card redesign - hardcoded data only, nothing
// here reads league state or is reused by the other tabs until a design is
// finalized.

// Next local-time occurrence of a weekday + time (0 = Sunday), so each
// sample's kickoffAt agrees with its hardcoded "Sun 4:25 PM" status text
// in whatever time zone the preview is opened.
function nextKickoff(weekday: number, hour: number, minute: number): number {
  const date = new Date();
  date.setDate(date.getDate() + ((weekday - date.getDay() + 7) % 7));
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

// One row per state the Matchup tab can put a card in: live vs. pregame,
// final vs. injured, rookie vs. bye, and a filled slot vs. an empty one.
// The second RB row pairs Bijan Robinson's teammate Brian Robinson Jr. so
// the short-name collision guard is visible (neither shortens to "B.").
const SAMPLE_ROWS: {
  slot: string;
  a: GlassMatchupCardData | null;
  b: GlassMatchupCardData | null;
}[] = [
  {
    slot: "QB",
    a: {
      name: "Josh Allen",
      seasonPpg: 24.1,
      rosPpg: 22.8,
      weekPositionRank: 2,
      byeWeek: 7,
      position: "QB",
      positionRank: 1,
      team: "BUF",
      matchup: "vs. KC",
      status: "Q3 8:12",
      gameState: "live",
      projectedPoints: 23.4,
      liveProjectedPoints: 27.9,
      actualPoints: 19.86,
    },
    b: {
      name: "Patrick Mahomes",
      seasonPpg: 19.6,
      rosPpg: 20.4,
      weekPositionRank: 8,
      byeWeek: 10,
      position: "QB",
      positionRank: 6,
      team: "KC",
      matchup: "@ BUF",
      status: "Q3 8:12",
      gameState: "live",
      projectedPoints: 20.1,
      liveProjectedPoints: 16.4,
      actualPoints: 11.22,
    },
  },
  {
    slot: "RB",
    a: {
      name: "Bijan Robinson",
      seasonPpg: 19.8,
      rosPpg: 18.9,
      weekPositionRank: 3,
      byeWeek: 5,
      position: "RB",
      positionRank: 2,
      team: "ATL",
      matchup: "vs. TB",
      status: "Final",
      gameState: "final",
      projectedPoints: 18.7,
      actualPoints: 24.6,
    },
    b: {
      name: "Christian McCaffrey",
      seasonPpg: 15.2,
      rosPpg: 16.1,
      weekPositionRank: 12,
      byeWeek: 14,
      position: "RB",
      positionRank: 11,
      team: "SF",
      matchup: "@ LAR",
      status: "Sun 4:25 PM",
      kickoffAt: nextKickoff(0, 16, 25),
      gameState: "pre",
      projectedPoints: 15.2,
      actualPoints: 0,
      injury: { status: "Questionable", statusShort: "Q" },
    },
  },
  {
    slot: "RB",
    a: {
      name: "Brian Robinson Jr.",
      seasonPpg: 8.4,
      rosPpg: 8.0,
      weekPositionRank: 31,
      byeWeek: 5,
      position: "RB",
      positionRank: 28,
      team: "ATL",
      matchup: "vs. TB",
      status: "Final",
      gameState: "final",
      projectedPoints: 7.9,
      actualPoints: 5.8,
    },
    b: {
      name: "Jahmyr Gibbs",
      seasonPpg: 18.3,
      rosPpg: 17.9,
      weekPositionRank: 5,
      byeWeek: 8,
      position: "RB",
      positionRank: 4,
      team: "DET",
      matchup: "vs. GB",
      status: "Mon 8:15 PM",
      kickoffAt: nextKickoff(1, 20, 15),
      gameState: "pre",
      projectedPoints: 17.6,
      actualPoints: 0,
    },
  },
  {
    slot: "WR",
    a: {
      name: "Marvin Harrison Jr.",
      seasonPpg: 12.9,
      rosPpg: 13.6,
      weekPositionRank: 18,
      byeWeek: 8,
      position: "WR",
      positionRank: 14,
      team: "ARI",
      matchup: "vs. SEA",
      status: "Sun 4:05 PM",
      kickoffAt: nextKickoff(0, 16, 5),
      gameState: "pre",
      projectedPoints: 13.8,
      actualPoints: 0,
      isRookie: true,
    },
    b: {
      name: "Justin Jefferson",
      seasonPpg: 17.5,
      rosPpg: 17.0,
      byeWeek: 6,
      position: "WR",
      positionRank: 3,
      team: "MIN",
      matchup: "BYE",
      gameState: "bye",
    },
  },
  {
    slot: "FLEX",
    a: {
      name: "Travis Kelce",
      seasonPpg: 11.8,
      rosPpg: 10.9,
      weekPositionRank: 6,
      byeWeek: 10,
      position: "TE",
      positionRank: 5,
      team: "KC",
      matchup: "@ BUF",
      status: "Q3 8:12",
      gameState: "live",
      projectedPoints: 11.0,
      liveProjectedPoints: 11.6,
      actualPoints: 8.4,
      injury: { status: "Doubtful", statusShort: "D" },
    },
    b: null,
  },
];

// Stand-in for the league-wide player pool the real Matchup tab would check
// collisions against - here just the sample cards themselves.
const shortName = buildShortNames(
  SAMPLE_ROWS.flatMap((row) => [row.a?.name, row.b?.name]).filter(
    (name): name is string => name !== undefined,
  ),
);

const scaleMax = meterScaleMax(
  SAMPLE_ROWS.flatMap((row) => [row.a, row.b]).filter(
    (card): card is GlassMatchupCardData => card !== null,
  ),
);

function CardsPage() {
  return (
    <Stack gap="md">
      <Stack gap={2}>
        <Title order={3}>Cards</Title>
        <Text size="sm" c="dimmed">
          Design sandbox. Sample data only.
        </Text>
      </Stack>

      <Text fw={600}>Matchup: base card</Text>

      <Stack gap={10}>
        {SAMPLE_ROWS.map((row, index) => (
          <Group key={index} wrap="nowrap" gap="xs" align="stretch">
            <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
              {row.a ? (
                <GlassMatchupCard
                  data={row.a}
                  displayName={shortName(row.a.name)}
                  slot={row.slot}
                  scaleMax={scaleMax}
                />
              ) : (
                <EmptyGlassCard />
              )}
            </Box>
            <GlassSlotChip label={row.slot} />
            <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
              {row.b ? (
                <GlassMatchupCard
                  data={row.b}
                  displayName={shortName(row.b.name)}
                  slot={row.slot}
                  scaleMax={scaleMax}
                />
              ) : (
                <EmptyGlassCard />
              )}
            </Box>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}
