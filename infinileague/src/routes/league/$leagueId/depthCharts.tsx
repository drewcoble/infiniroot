import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Badge, Card, Group, Loader, Select, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { positionColorOrDefault } from "@shared/positionColors";
import type { Position } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { PlayerCard } from "../../../components/PlayerCard";
import type { RosVorRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/depthCharts")({
  component: DepthChartsPage,
});

interface NflState {
  season: string;
  week: string;
  seasonType: "pre" | "regular" | "post";
}

// Mirrors convex/tank01/depthChartsData.ts's DepthChartPlayerRow return
// shape - same "duplicate the backend type in the frontend" convention
// types/season.ts's RosVorRow already uses (see its own comment), since src/
// never imports runtime convex/ modules directly, only the generated api/
// dataModel types.
interface DepthChartPlayerRow {
  fpid: number;
  name: string;
  position: Position;
  depthPosition: string;
}

// Fantasy-relevant only, in the order a depth chart is naturally scanned -
// convex/tank01/depthChartsData.ts's getTeamDepthChart never returns DST or
// individual defenders (LB/DL/DB), so this list is exhaustive, not just a
// filter.
const DEPTH_CHART_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K"];

// "RB1" < "RB2" < ... < "RB10" - Tank01's own depthPosition string sorts
// wrong past 9 deep on a plain string compare (never seen in practice, the
// deepest position confirmed live was WR8, but this costs nothing to get
// right). Trailing digits only; anything unparseable sorts last rather than
// throwing.
function depthPositionRank(depthPosition: string): number {
  const match = depthPosition.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

// Team selector's options come from the data itself (listDepthChartTeams),
// not a hardcoded 32-team list - see that query's own comment for why
// (Tank01's abbreviations don't all match this app's Sleeper-derived
// convention elsewhere, e.g. Washington).
function DepthChartsPage() {
  const { isAuthenticated } = useConvexAuth();
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  const teams = useQuery(
    api.tank01.depthChartsData.listDepthChartTeams,
    isAuthenticated ? {} : "skip",
  );

  const nflState: NflState | null | undefined = useQuery(
    api.nflState.getNflState,
    isAuthenticated ? {} : "skip",
  );

  const depthChart: DepthChartPlayerRow[] | undefined = useQuery(
    api.tank01.depthChartsData.getTeamDepthChart,
    isAuthenticated && selectedTeam ? { team: selectedTeam } : "skip",
  );

  // Same league-wide board the Players tab reads (src/routes/league/
  // $leagueId/players.tsx) - reused rather than duplicated so a player's
  // "WR21" badge and PPG here always agree with what the Players tab shows
  // for the same fpid. Not every depth-chart player has a row here (the
  // board is trimmed to fantasy-relevant players - a WR7 or TE4 buried on
  // the bench may fall below that cutoff), handled per-row below.
  const rosVorRows: RosVorRow[] | undefined = useQuery(
    api.rosVor.getRosVorBoard,
    isAuthenticated && nflState ? { seasonId, week: nflState.week } : "skip",
  );
  const rosVorByFpid = new Map((rosVorRows ?? []).map((row) => [row.fpid, row]));

  const rookieFpids = useQuery(
    api.players.getRookieFpids,
    isAuthenticated ? {} : "skip",
  );
  const rookieFpidSet = new Set(rookieFpids ?? []);

  const byPosition = new Map<Position, DepthChartPlayerRow[]>();
  for (const row of depthChart ?? []) {
    const list = byPosition.get(row.position) ?? [];
    list.push(row);
    byPosition.set(row.position, list);
  }
  for (const list of byPosition.values()) {
    list.sort((a, b) => depthPositionRank(a.depthPosition) - depthPositionRank(b.depthPosition));
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" align="center">
        <Title order={3}>Depth Charts</Title>
        <Select
          placeholder={teams === undefined ? "Loading teams..." : "Select a team"}
          data={teams ?? []}
          value={selectedTeam}
          onChange={setSelectedTeam}
          searchable
          disabled={teams === undefined || teams.length === 0}
          w={{ base: "100%", sm: 200 }}
        />
      </Group>

      {teams !== undefined && teams.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Depth chart data hasn&apos;t been synced yet.
        </Text>
      )}

      {!selectedTeam && teams && teams.length > 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Select a team to see its depth chart.
        </Text>
      )}

      {selectedTeam && depthChart === undefined && <Loader />}

      {selectedTeam && depthChart && (
        <Stack gap="lg">
          {DEPTH_CHART_POSITIONS.map((pos) => {
            const rows = byPosition.get(pos);
            if (!rows || rows.length === 0) return null;
            return (
              <Stack key={pos} gap={6}>
                <Badge size="lg" variant="light" color={positionColorOrDefault(pos)} w="fit-content">
                  {pos}
                </Badge>
                <Stack gap={8}>
                  {rows.map((row) => {
                    const rosVorRow = rosVorByFpid.get(row.fpid);
                    if (rosVorRow) {
                      return (
                        <PlayerCard
                          key={row.fpid}
                          row={rosVorRow}
                          isRookie={rookieFpidSet.has(row.fpid)}
                          leftLabel={row.depthPosition}
                        />
                      );
                    }
                    // No rosVOR row for this fpid (below the fantasy-
                    // relevance cutoff) - a lighter fallback rather than
                    // forcing PlayerCard's PPG/rank fields, which don't
                    // exist for this player.
                    return (
                      <Card key={row.fpid} withBorder padding="xs" radius="md">
                        <Group wrap="nowrap" gap="sm">
                          <Text size="sm" fw={700} c="dimmed" w={28} ta="right">
                            {row.depthPosition}
                          </Text>
                          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                            <Text size="sm" fw={500} truncate>
                              {row.name}
                            </Text>
                            {rookieFpidSet.has(row.fpid) && <RookieBadge />}
                          </Group>
                          <Text size="xs" c="dimmed">
                            No ranking data
                          </Text>
                        </Group>
                      </Card>
                    );
                  })}
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
