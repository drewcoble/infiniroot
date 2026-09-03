import { useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Group, Loader, Stack, Text, Title } from "@mantine/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "@infinidata/api";
import { PlayerCard } from "../../../components/PlayerCard";
import type { RosVorRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/players")({
  component: PlayersPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// Card height (52px) + the gap below it (8px) - has to match PlayerCard's
// actual rendered height for the virtualizer's offsets to line up; there's
// no ResizeObserver measuring it live since every card is the same fixed
// shape (see PlayerCard's own comment).
const PLAYER_CARD_HEIGHT = 60;

// Every rosterable player in the league (rostered or free agent), ranked by
// rosVOR - the full board convex/rosVor.ts computes, not just the free
// agents the Free Agents tab shows. Windowed against the page's own scroll
// (useWindowVirtualizer) rather than a nested scrolling box, matching how
// every other infinileague page scrolls - only cards actually in the
// viewport are ever mounted, so this stays smooth even at 800+ players.
function PlayersPage() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const rookieFpids = useQuery(
    api.players.getRookieFpids,
    isAuthenticated ? {} : "skip",
  );
  const rookieFpidSet = new Set(rookieFpids ?? []);

  const rows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: rows?.length ?? 0,
    estimateSize: () => PLAYER_CARD_HEIGHT,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (nflState === undefined || rows === undefined) {
    return <Loader />;
  }

  if (nflState === null || nflState.seasonType !== "regular") {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Not currently in an NFL regular season week.</Text>
        <Text c="dimmed" size="sm">
          Player rankings will appear here once the season starts.
        </Text>
      </Stack>
    );
  }

  // getRosVorBoard only ever reads the cache convex/rosVor.ts's daily cron
  // writes - unlike FAAB, it has no live-compute fallback (recomputing the
  // full league-wide board on every reactive query re-run would be far more
  // expensive than FAAB's one-shot fallback). An empty board here almost
  // always means the cron hasn't run for this league/week yet, not that
  // there are genuinely zero players - worth saying so explicitly rather
  // than silently rendering nothing under a "0 players" header.
  if (rows.length === 0) {
    return (
      <Stack align="center" py="xl" gap={4}>
        <Text c="dimmed">Player rankings haven&apos;t been computed for this week yet.</Text>
        <Text c="dimmed" size="sm">
          Check back after the next daily refresh.
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={3}>Players — Week {nflState.week}</Title>
        <Text c="dimmed" size="sm">
          {rows.length} players
        </Text>
      </Group>
      <div ref={listRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          if (!row) return null;
          return (
            <div
              key={row.fpid}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                paddingBottom: 8,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <PlayerCard row={row} isRookie={rookieFpidSet.has(row.fpid)} />
            </div>
          );
        })}
      </div>
    </Stack>
  );
}
