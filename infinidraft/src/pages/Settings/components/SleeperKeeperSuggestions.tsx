import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import type { Position } from "../../../types";
import { POSITION_COLORS } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { EditableNumberStepper } from "../../../components/NumberStepper";
import {
  computeKeeperCost,
  computeKeeperCostRound,
  formulaForFpid,
  keeperPairKey,
  roundFormulaForFpid,
  type KeeperPriceHistoryEntry,
  type KeeperRules,
} from "../../../lib/keeperCost";
import { getErrorMessage } from "@shared/errors";

interface ProjectionRow {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

interface SleeperKeeperSuggestionsProps {
  seasonId: Id<"seasons">;
  sleeperLeagueId: string | undefined;
  draftTeams: Doc<"seasonTeams">[];
  allProjections: ProjectionRow[] | undefined;
  priceHistory: Record<number, KeeperPriceHistoryEntry> | undefined;
  keeperRules: KeeperRules | undefined;
  // (teamId, fpid) pairs already confirmed as real keepers - used to drop a
  // suggestion off the list the moment its "Add" button succeeds, without
  // needing to track that locally (this component's own `suggestions` state
  // never changes; only the filter over it does, on every keepers update).
  existingKeeperKeys: Set<string>;
  rookieFpids: Set<number>;
  // A snake/linear league's keeper cost is a draft-slot round, not a
  // dollar price (SNAKE_DRAFT.md §8) - branches the suggested-cost formula
  // and the Cost column's label/input below.
  isSnakeOrLinear: boolean;
  onAddKeeper: (
    fpid: number,
    position: Position,
    cost: number,
    teamId: Id<"seasonTeams">,
  ) => void;
  onSelectPlayer: (fpid: number) => void;
}

// Sleeper lets owners lock in next season's keepers well before the actual
// draft (roster.keepers - see convex/sleeper/league.ts's SleeperRoster
// comment), completely separately from this app's own draftPicks. This
// panel reads that list on demand and turns each (team, player) pair into a
// one-click "confirm the cost, add as keeper" row - Sleeper never tells us a
// price, so that part still needs a human, prefilled with this league's own
// keeper-cost formula same as Recommended Keepers does.
export function SleeperKeeperSuggestions({
  seasonId,
  sleeperLeagueId,
  draftTeams,
  allProjections,
  priceHistory,
  keeperRules,
  existingKeeperKeys,
  rookieFpids,
  isSnakeOrLinear,
  onAddKeeper,
  onSelectPlayer,
}: SleeperKeeperSuggestionsProps) {
  const fetchSuggestions = useAction(
    api.sleeper.league.listSleeperKeeperSuggestions,
  );
  const [suggestions, setSuggestions] = useState<
    Array<{ teamId: Id<"seasonTeams">; fpid: number }> | null
  >(null);
  const [costOverrides, setCostOverrides] = useState<Record<number, number>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchSuggestions({ seasonId });
      setSuggestions(result);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to check Sleeper for keepers."));
    } finally {
      setIsLoading(false);
    }
  };

  const teamById = useMemo(
    () => new Map(draftTeams.map((team) => [team._id, team])),
    [draftTeams],
  );
  const projectionByFpid = useMemo(
    () => new Map((allProjections ?? []).map((row) => [row.fpid, row])),
    [allProjections],
  );

  const pendingRows = useMemo(() => {
    if (!suggestions) return [];
    return suggestions
      .filter(
        (s) => !existingKeeperKeys.has(keeperPairKey(s.teamId, s.fpid)),
      )
      .map((s) => {
        const team = teamById.get(s.teamId);
        const player = projectionByFpid.get(s.fpid);
        if (!team || !player) return null;

        let suggestedCost: number | null = null;
        if (keeperRules) {
          if (isSnakeOrLinear) {
            const roundFormula = roundFormulaForFpid(
              keeperRules,
              s.fpid,
              player.position,
            );
            suggestedCost = roundFormula
              ? computeKeeperCostRound(
                  roundFormula,
                  priceHistory?.[s.fpid]?.round,
                )
              : null;
          } else {
            const formula = formulaForFpid(keeperRules, s.fpid, player.position);
            suggestedCost = computeKeeperCost(
              formula,
              priceHistory?.[s.fpid]?.price,
            );
          }
        }

        return { teamId: s.teamId, teamName: team.name, player, suggestedCost };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [
    suggestions,
    existingKeeperKeys,
    teamById,
    projectionByFpid,
    keeperRules,
    priceHistory,
    isSnakeOrLinear,
  ]);

  if (!sleeperLeagueId) return null;

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500}>
            Import Keepers from Sleeper
          </Text>
          <Button
            variant="light"
            size="xs"
            onClick={handleCheck}
            disabled={isLoading}
          >
            {isLoading ? <Loader size="xs" /> : "Check Sleeper"}
          </Button>
        </Group>
        {error && (
          <Alert variant="light" color="red">
            {error}
          </Alert>
        )}
        {suggestions !== null && pendingRows.length === 0 && (
          <Text size="xs" c="dimmed">
            {suggestions.length === 0
              ? "No keepers set on Sleeper yet for any linked team."
              : "All of Sleeper's keepers for linked teams are already added here."}
          </Text>
        )}
        {pendingRows.length > 0 && (
          <>
            <Text size="xs" c="dimmed">
              Sleeper only tells us who's kept, not the{" "}
              {isSnakeOrLinear ? "round" : "price"} - confirm a cost for each
              before adding.
            </Text>
            <Table.ScrollContainer minWidth={360}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Team</Table.Th>
                    <Table.Th>Player</Table.Th>
                    <Table.Th ta="right">
                      {isSnakeOrLinear ? "Round" : "Cost"}
                    </Table.Th>
                    <Table.Th></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {pendingRows.map(({ teamId, teamName, player, suggestedCost }) => {
                    const cost = costOverrides[player.fpid] ?? suggestedCost ?? 1;
                    return (
                      <Table.Tr key={keeperPairKey(teamId, player.fpid)}>
                        <Table.Td>
                          <Text size="sm">{teamName}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6} wrap="nowrap">
                            <Badge
                              size="sm"
                              variant="light"
                              color={POSITION_COLORS[player.position]}
                            >
                              {player.position}
                            </Badge>
                            <Anchor
                              component="button"
                              type="button"
                              size="sm"
                              onClick={() => onSelectPlayer(player.fpid)}
                            >
                              {player.name}
                            </Anchor>
                            {rookieFpids.has(player.fpid) && <RookieBadge />}
                          </Group>
                        </Table.Td>
                        <Table.Td ta="right">
                          <EditableNumberStepper
                            label={isSnakeOrLinear ? "Round" : "Cost"}
                            min={1}
                            {...(isSnakeOrLinear ? {} : { prefix: "$" })}
                            width={80}
                            size="xs"
                            value={cost}
                            onChange={(value) =>
                              setCostOverrides((current) => ({
                                ...current,
                                [player.fpid]: value ?? 1,
                              }))
                            }
                          />
                        </Table.Td>
                        <Table.Td>
                          <Anchor
                            component="button"
                            type="button"
                            size="xs"
                            onClick={() =>
                              onAddKeeper(player.fpid, player.position, cost, teamId)
                            }
                          >
                            Add
                          </Anchor>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
      </Stack>
    </Card>
  );
}
