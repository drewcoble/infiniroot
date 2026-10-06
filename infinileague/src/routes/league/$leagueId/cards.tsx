import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Box, Group, SegmentedControl, Stack, Text, Title } from "@mantine/core";
import {
  EmptyGlassCard,
  GlassMatchupCard,
  GlassSlotChip,
  type GlassMatchupCardData,
} from "../../../components/cards/GlassMatchupCard";

export const Route = createFileRoute("/league/$leagueId/cards")({
  component: CardsPage,
});

// Design sandbox for the player-card redesign - hardcoded data only, nothing
// here reads league state or is reused by the other tabs until a design is
// finalized.

type Backdrop = "app" | "ambient";

// One row per state the Matchup tab can put a card in: live vs. pregame,
// final vs. injured, rookie vs. bye, and a filled slot vs. an empty one.
const SAMPLE_ROWS: {
  slot: string;
  a: GlassMatchupCardData | null;
  b: GlassMatchupCardData | null;
}[] = [
  {
    slot: "QB",
    a: {
      name: "Josh Allen",
      position: "QB",
      positionRank: 1,
      team: "BUF",
      gameLine: "vs. KC · Q3 8:12",
      gameState: "live",
      projectedPoints: 23.4,
      liveProjectedPoints: 27.9,
      actualPoints: 19.86,
    },
    b: {
      name: "Patrick Mahomes",
      position: "QB",
      positionRank: 6,
      team: "KC",
      gameLine: "@ BUF · Q3 8:12",
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
      position: "RB",
      positionRank: 2,
      team: "ATL",
      gameLine: "vs. TB · Final",
      gameState: "final",
      projectedPoints: 18.7,
      actualPoints: 24.6,
    },
    b: {
      name: "Christian McCaffrey",
      position: "RB",
      positionRank: 11,
      team: "SF",
      gameLine: "@ LAR · Sun 4:25 PM",
      gameState: "pre",
      projectedPoints: 15.2,
      actualPoints: 0,
      injury: { status: "Questionable", statusShort: "Q" },
    },
  },
  {
    slot: "WR",
    a: {
      name: "Marvin Harrison Jr.",
      position: "WR",
      positionRank: 14,
      team: "ARI",
      gameLine: "vs. SEA · Sun 4:05 PM",
      gameState: "pre",
      projectedPoints: 13.8,
      actualPoints: 0,
      isRookie: true,
    },
    b: {
      name: "Justin Jefferson",
      position: "WR",
      positionRank: 3,
      team: "MIN",
      gameLine: "BYE",
      gameState: "bye",
    },
  },
  {
    slot: "FLEX",
    a: {
      name: "Travis Kelce",
      position: "TE",
      positionRank: 5,
      team: "KC",
      gameLine: "@ BUF · Q3 8:12",
      gameState: "live",
      projectedPoints: 11.0,
      liveProjectedPoints: 12.3,
      actualPoints: 8.4,
      injury: { status: "Doubtful", statusShort: "D" },
    },
    b: null,
  },
];

// Glass only reads as glass when there's something behind it to blur -
// "App" is the real page background the Matchup tab has today, "Ambient"
// adds a soft color field so the blur and border are visible.
const AMBIENT_BACKGROUND = [
  "radial-gradient(circle at 15% 20%, rgba(34, 197, 94, 0.55), transparent 45%)",
  "radial-gradient(circle at 85% 35%, rgba(59, 130, 246, 0.5), transparent 45%)",
  "radial-gradient(circle at 40% 90%, rgba(236, 72, 153, 0.4), transparent 50%)",
  "var(--mantine-color-body)",
].join(", ");

function CardsPage() {
  const [backdrop, setBackdrop] = useState<Backdrop>("ambient");

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm">
        <Stack gap={2}>
          <Title order={3}>Cards</Title>
          <Text size="sm" c="dimmed">
            Design sandbox. Sample data only.
          </Text>
        </Stack>
        <SegmentedControl
          size="xs"
          value={backdrop}
          onChange={(value) => setBackdrop(value as Backdrop)}
          data={[
            { value: "ambient", label: "Ambient" },
            { value: "app", label: "App bg" },
          ]}
          aria-label="Preview backdrop"
        />
      </Group>

      <Text fw={600}>Matchup: base card</Text>

      <Box
        p={{ base: "sm", sm: "lg" }}
        style={{
          borderRadius: 20,
          background: backdrop === "ambient" ? AMBIENT_BACKGROUND : "var(--mantine-color-body)",
        }}
      >
        <Stack gap={10}>
          {SAMPLE_ROWS.map((row) => (
            <Group key={row.slot} wrap="nowrap" gap="xs" align="stretch">
              <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
                {row.a ? <GlassMatchupCard data={row.a} /> : <EmptyGlassCard />}
              </Box>
              <GlassSlotChip label={row.slot} />
              <Box style={{ flex: 1, minWidth: 0, display: "grid" }}>
                {row.b ? <GlassMatchupCard data={row.b} /> : <EmptyGlassCard />}
              </Box>
            </Group>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}
