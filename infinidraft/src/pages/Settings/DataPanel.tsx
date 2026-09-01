import { useState } from "react";
import { useAction } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Group,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";

interface DataPanelProps {
  week: string;
}

type ActionKey =
  | "projections"
  | "playerPoints"
  | "caches"
  | "espnLinks"
  | "espnRankings"
  | "blend";

interface ActionState {
  isRunning: boolean;
  status: { kind: "success" | "error"; message: string } | null;
}

const IDLE_STATE: ActionState = { isRunning: false, status: null };

export function DataPanel({ week }: DataPanelProps) {
  const fetchProjections = useAction(api.sleeper.projections.fetchProjections);
  const fetchPlayerPoints = useAction(
    api.sleeper.playerPoints.fetchAllPlayerPoints,
  );
  const refreshCaches = useAction(api.fetchAllData.refreshCaches);
  const fetchSleeperPlayerLinks = useAction(
    api.sleeper.playerLinks.fetchSleeperPlayerLinks,
  );
  const fetchEspnRankings = useAction(api.espn.rankings.fetchEspnRankings);
  const blendAllProjections = useAction(
    api.projectionBlending.blendAllProjections,
  );

  // Defaults to the current season server-side (see fetchAllPlayerPoints)
  // when left blank - only needs to be filled in to backfill a past season
  // (e.g. to populate the new per-week stats field for the player detail
  // modal's game log on seasons already in the database).
  const [playerPointsYear, setPlayerPointsYear] = useState("");

  const [states, setStates] = useState<Record<ActionKey, ActionState>>({
    projections: IDLE_STATE,
    playerPoints: IDLE_STATE,
    caches: IDLE_STATE,
    espnLinks: IDLE_STATE,
    espnRankings: IDLE_STATE,
    blend: IDLE_STATE,
  });

  const actions: Array<{
    key: ActionKey;
    label: string;
    description: string;
    run: () => Promise<unknown>;
    // Either a fixed string, or built from the resolved action result (e.g.
    // match counts) - see runAction below.
    successMessage: string | ((result: unknown) => string);
  }> = [
    {
      key: "projections",
      label: "Fetch projections",
      description:
        "Players, ADP/rankings, and injuries (K/DST projections too). QB/RB/WR/TE projections need \"Fetch ESPN values\" + \"Blend projections\" after this to actually update.",
      run: () => fetchProjections({ week }),
      successMessage: `Projections refreshed for week "${week}".`,
    },
    {
      key: "playerPoints",
      label: "Fetch player points",
      description: "Actual scored fantasy points, per week.",
      run: () =>
        fetchPlayerPoints(
          playerPointsYear.trim() ? { year: playerPointsYear.trim() } : {},
        ),
      successMessage: `Player points refreshed${
        playerPointsYear.trim() ? ` for ${playerPointsYear.trim()}` : ""
      }.`,
    },
    {
      key: "caches",
      label: "Refresh value caches",
      description: "Recomputes value-gap and $-value caches.",
      run: () => refreshCaches({ week }),
      successMessage: "Value caches refreshed.",
    },
    {
      key: "espnLinks",
      label: "Link ESPN/Yahoo IDs",
      description:
        "Backfills each player's ESPN/Yahoo id from Sleeper's full player list, for joining external rankings.",
      run: () => fetchSleeperPlayerLinks({}),
      successMessage: (result) => {
        const { patched, scanned } = result as {
          patched: number;
          skipped: number;
          scanned: number;
        };
        return `Linked ${patched} of ${scanned} candidate players.`;
      },
    },
    {
      key: "espnRankings",
      label: "Fetch ESPN values",
      description:
        "ESPN's standard/PPR/superflex draft-kit ranks & auction values, plus raw per-category projected stats, matched to players by ESPN id (falling back to name+position, which also backfills the id for next time).",
      run: () => fetchEspnRankings({ week }),
      successMessage: (result) => {
        const {
          directMatched,
          nameMatched,
          ambiguous,
          unmatched,
          totalPlayers,
          rowsByFormat,
          statRowsByPosition,
        } = result as {
          totalPlayers: number;
          directMatched: number;
          nameMatched: number;
          ambiguous: number;
          unmatched: number;
          rowsByFormat: { standard: number; ppr: number; superflex: number };
          statRowsByPosition: Record<string, number>;
        };
        const statCounts = Object.entries(statRowsByPosition)
          .map(([position, count]) => `${position}=${count}`)
          .join(", ");
        return (
          `Matched ${directMatched + nameMatched} of ${totalPlayers} players (${directMatched} by id, ` +
          `${nameMatched} by name; ${ambiguous} ambiguous, ${unmatched} unmatched). ` +
          `Values: standard=${rowsByFormat.standard}, ppr=${rowsByFormat.ppr}, superflex=${rowsByFormat.superflex}. ` +
          `Stat rows: ${statCounts}.`
        );
      },
    },
    {
      key: "blend",
      label: "Blend projections",
      description:
        "Averages every provider's raw stats (Sleeper + ESPN) into the QB/RB/WR/TE projections everything else reads. Run after \"Fetch projections\" and \"Fetch ESPN values\".",
      run: () => blendAllProjections({ week }),
      successMessage: (result) => {
        const byPosition = result as Record<
          string,
          { upserted: number; removed: number }
        >;
        return Object.entries(byPosition)
          .map(([position, { upserted }]) => `${position}=${upserted}`)
          .join(", ");
      },
    },
  ];

  const runAction = async (action: (typeof actions)[number]) => {
    setStates((prev) => ({
      ...prev,
      [action.key]: { isRunning: true, status: null },
    }));

    try {
      const result = await action.run();
      const message =
        typeof action.successMessage === "function"
          ? action.successMessage(result)
          : action.successMessage;
      setStates((prev) => ({
        ...prev,
        [action.key]: {
          isRunning: false,
          status: { kind: "success", message },
        },
      }));
    } catch (error) {
      const message = getErrorMessage(error, "Something went wrong.");
      setStates((prev) => ({
        ...prev,
        [action.key]: { isRunning: false, status: { kind: "error", message } },
      }));
    }
  };

  return (
    <Stack gap="md" py="sm">
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {actions.map((action) => {
          const state = states[action.key];
          return (
            <Card key={action.key} withBorder padding="md">
              <Stack gap="sm" justify="space-between" h="100%">
                <Stack gap={4}>
                  <Text fw={500}>{action.label}</Text>
                  <Text size="sm" c="dimmed">
                    {action.description}
                  </Text>
                </Stack>
                <Stack gap="xs">
                  {action.key === "playerPoints" && (
                    <TextInput
                      placeholder="Year (optional)"
                      value={playerPointsYear}
                      onChange={(event) =>
                        setPlayerPointsYear(event.currentTarget.value)
                      }
                    />
                  )}
                  <Group justify="space-between" align="center">
                    <Button
                      onClick={() => runAction(action)}
                      loading={state.isRunning}
                    >
                      {action.label}
                    </Button>
                  </Group>
                  {state.status && (
                    <Alert
                      color={state.status.kind === "success" ? "green" : "red"}
                      variant="light"
                    >
                      {state.status.message}
                    </Alert>
                  )}
                </Stack>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
