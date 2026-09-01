import { useMemo, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import type { Doc } from "@infinidata/dataModel";
import type { Position } from "../../../types";
import { POSITION_COLORS } from "@shared/positionColors";
import { RookieBadge } from "@shared/RookieBadge";
import { useRookieFpids } from "../../../hooks/useRookieFpids";
import {
  computeKeeperCost,
  computeKeeperCostRound,
  expectedValueAtRound,
  formulaForFpid,
  prospectiveKeeperStreak,
  roundFormulaForFpid,
  valueImpliedRound,
  type KeeperPriceHistoryEntry,
  type KeeperRules,
} from "../../../lib/keeperCost";
import {
  sortValuesDescending,
  type ValueRankEntry,
} from "../../../lib/valueRank";

interface ProjectionRow {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

interface RecommendedKeepersProps {
  priceHistory: Record<number, KeeperPriceHistoryEntry> | undefined;
  keeperRules: KeeperRules | undefined;
  draftValueByFpid: Map<number, { dollarValue: number }>;
  allProjections: ProjectionRow[] | undefined;
  activePositions: readonly Position[];
  draftedFpids: Set<number>;
  // A snake/linear league's keeper cost/value is round-denominated instead
  // of dollar-denominated (SNAKE_DRAFT.md §8) - availableValues/teamCount
  // are only needed in that mode, to rank each candidate's own dollarValue
  // against a pooled, rank-based "expected value at this round" curve
  // (see keeperCost.ts's valueImpliedRound/expectedValueAtRound for why
  // that's used instead of comparing round numbers or real ADP directly).
  isSnakeOrLinear: boolean;
  // Every currently-undrafted/unkept player's own dollarValue - the pool
  // valueImpliedRound/expectedValueAtRound rank against. Deliberately NOT
  // draftValueByFpid (which also carries interpolated values for players
  // already kept elsewhere) - a kept player isn't actually available at
  // any round this year, so it shouldn't occupy a rank band.
  availableValues: readonly ValueRankEntry[];
  teamCount: number;
  // For the team filter below - lets the host scope the list to their own
  // roster (the default) instead of always seeing a leaguewide top-10
  // that's mostly other teams' players and rarely useful for deciding
  // your own keepers.
  draftTeams: Doc<"seasonTeams">[];
  // Adds the keeper outright at the suggested cost - team is resolved by
  // the caller (KeepersTab.tsx) from `teamName` below when it's set
  // (a confirmed manual-entry roster - see getPlayerPriceHistory), falling
  // back to whatever team is otherwise selected.
  onQuickAdd: (
    fpid: number,
    position: Position,
    cost: number,
    teamName: string | undefined,
  ) => void;
  onSelectPlayer: (fpid: number) => void;
  onOpenManualEntry: () => void;
}

// Only applied when scoped to "All Teams" - a leaguewide top-10 is a
// useful bargain-scouting summary, but a single team's roster is small
// enough (a season's worth of keeper-eligible players) that capping it
// the same way would hide legitimate candidates for no reason.
const MAX_RECOMMENDATIONS = 10;
const ALL_TEAMS = "all";
// Distinguishes a historical-only team-name filter option from a real
// current seasonTeams._id in the same Select - see orphanedTeamNames below.
const HISTORY_PREFIX = "history:";

// One normalized recommendation row, regardless of format - keeps the JSX
// below branch-free (just render whatever labels were precomputed) instead
// of threading isSnakeOrLinear through every cell.
interface RecommendationRow {
  player: ProjectionRow;
  teamName: string | undefined;
  // Raw suggested cost (a dollar amount or a round number depending on
  // format) - what onQuickAdd actually sends on to addKeeper. costLabel
  // below is just this same number, formatted for display.
  costValue: number;
  costLabel: string;
  marketLabel: string;
  savingsLabel: string;
  // What "recommendations" is sorted by, descending - bigger is always a
  // better bargain in both modes ($ saved, or rounds saved).
  sortValue: number;
}

// Surfaces the league's best keeper bargains (this year's fair value minus
// what the keeper-cost formula would charge to keep them) so a host doesn't
// have to manually search every name from last year's draft to find one.
// Scoped to one team at a time via the picker below (defaulting to the
// host's own team, the most common reason to open this at all) - a
// leaguewide top-10 tends to be dominated by other teams' best players,
// crowding out legitimate keeper decisions for your own roster. Only
// entries with a confirmed team (getPlayerPriceHistory's
// teamAssignmentConfirmed - a Sleeper import or manual entry, see
// convex/leagues.ts's importPreviousSeasonHistory) can be attributed to a
// team at all; an unconfirmed one only ever shows up under "All Teams".
// Clicking a row drops the name into the search box above so the host can
// pick it up through the normal add-a-keeper flow (team + confirm cost).
export function RecommendedKeepers({
  priceHistory,
  keeperRules,
  draftValueByFpid,
  allProjections,
  activePositions,
  draftedFpids,
  isSnakeOrLinear,
  availableValues,
  draftTeams,
  teamCount,
  onQuickAdd,
  onSelectPlayer,
  onOpenManualEntry,
}: RecommendedKeepersProps) {
  const rookieFpids = useRookieFpids();
  // Defaults to the host's own team (falling back to "All Teams" if this
  // season somehow has no self team yet) - see this component's header
  // comment on why that's the far more common reason to open this at all.
  const [teamFilter, setTeamFilter] = useState<string>(
    () => draftTeams.find((t) => t.isSelf)?._id ?? ALL_TEAMS,
  );
  // Last season's team names that don't match any CURRENT team - e.g. a
  // franchise changed hands and the new owner's team got a fresh name/row
  // instead of reusing the old one, so name-matching (the only join key
  // priceHistory has - see ManualPreviousSeasonModal.tsx's comment on the
  // same limitation) can't line them up automatically. Surfaced as their
  // own filter options (prefixed HISTORY_PREFIX) so a host in that
  // situation can still pick "the roster I actually took over" instead of
  // "My Team" silently coming up empty.
  const orphanedTeamNames = useMemo(() => {
    if (!priceHistory) return [];
    const currentNames = new Set(draftTeams.map((t) => t.name));
    const names = new Set<string>();
    for (const entry of Object.values(priceHistory)) {
      if (entry.teamName && !currentNames.has(entry.teamName)) {
        names.add(entry.teamName);
      }
    }
    return [...names].sort();
  }, [priceHistory, draftTeams]);
  const selectedTeamName =
    teamFilter === ALL_TEAMS
      ? undefined
      : teamFilter.startsWith(HISTORY_PREFIX)
        ? teamFilter.slice(HISTORY_PREFIX.length)
        : draftTeams.find((t) => t._id === teamFilter)?.name;
  const sortedValues = useMemo(
    () => sortValuesDescending(availableValues),
    [availableValues],
  );
  const recommendations = useMemo((): RecommendationRow[] => {
    if (!priceHistory || !keeperRules || !allProjections) return [];
    const projectionByFpid = new Map(
      allProjections.map((row) => [row.fpid, row]),
    );
    const activeSet = new Set(activePositions);

    const rows = Object.entries(priceHistory)
      .map((entryPair): RecommendationRow | null => {
        const [fpidStr, entry] = entryPair;
        const fpid = Number(fpidStr);
        if (
          selectedTeamName !== undefined &&
          entry.teamName !== selectedTeamName
        ) {
          return null;
        }
        const player = projectionByFpid.get(fpid);
        if (!player || !activeSet.has(player.position)) return null;
        if (draftedFpids.has(fpid)) return null;

        if (keeperRules.maxConsecutiveYears !== undefined) {
          const streak = prospectiveKeeperStreak(entry);
          if (streak > keeperRules.maxConsecutiveYears) return null;
        }

        if (isSnakeOrLinear) {
          const roundFormula = roundFormulaForFpid(
            keeperRules,
            fpid,
            player.position,
          );
          if (!roundFormula) return null;
          const keeperCostRound = computeKeeperCostRound(
            roundFormula,
            entry.round,
          );
          if (keeperCostRound === null) return null;

          // Ranked by projected dollarValue (the VOR-derived currency the
          // $ engine already computes), not by comparing round numbers or
          // real ADP directly - see keeperCost.ts's valueImpliedRound/
          // expectedValueAtRound for why (rounds aren't a linear value
          // unit, and real ADP can be skewed by position runs). dollarValue
          // is what actually decides which players qualify/how they rank;
          // the displayed "+N rounds" is a rounds-flavored readout of the
          // same comparison, not an independent number.
          const playerValue = draftValueByFpid.get(fpid)?.dollarValue;
          if (playerValue === undefined) return null;
          const expectedValue = expectedValueAtRound(
            keeperCostRound,
            sortedValues,
            teamCount,
          );
          if (expectedValue === null) return null;
          const dollarSurplus = playerValue - expectedValue;
          if (dollarSurplus <= 0) return null;

          const impliedRound = valueImpliedRound(
            playerValue,
            sortedValues,
            teamCount,
          );
          const savingsRounds = keeperCostRound - impliedRound;
          if (savingsRounds <= 0) return null;

          return {
            player,
            teamName: entry.teamName,
            costValue: keeperCostRound,
            costLabel: `Round ${keeperCostRound}`,
            marketLabel: `Fair round ${impliedRound}`,
            savingsLabel: `+${savingsRounds} rd${savingsRounds === 1 ? "" : "s"}`,
            sortValue: dollarSurplus,
          };
        }

        const fairValue = draftValueByFpid.get(fpid)?.dollarValue;
        if (fairValue === undefined) return null;

        const formula = formulaForFpid(keeperRules, fpid, player.position);
        const keeperCost = computeKeeperCost(formula, entry.price);
        if (keeperCost === null) return null;

        const savings = fairValue - keeperCost;
        if (savings <= 0) return null;

        return {
          player,
          teamName: entry.teamName,
          costValue: keeperCost,
          costLabel: `$${keeperCost}`,
          marketLabel: `$${Math.round(fairValue)}`,
          savingsLabel: `+$${Math.round(savings)}`,
          sortValue: savings,
        };
      })
      .filter((row): row is RecommendationRow => row !== null)
      .sort((a, b) => b.sortValue - a.sortValue);

    return teamFilter === ALL_TEAMS ? rows.slice(0, MAX_RECOMMENDATIONS) : rows;
  }, [
    priceHistory,
    keeperRules,
    allProjections,
    activePositions,
    draftedFpids,
    draftValueByFpid,
    isSnakeOrLinear,
    sortedValues,
    teamCount,
    teamFilter,
    selectedTeamName,
  ]);

  // No prior-season price data at all (no import, no manual entry) - prompt
  // for manual entry instead of a bare table with nothing to show, since
  // there's a concrete action available (unlike "no strong keeper values
  // found" below, which just means the data exists but nothing cleared the
  // savings bar).
  if (!priceHistory || Object.keys(priceHistory).length === 0) {
    return (
      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text size="sm" fw={500}>
            Recommended Keepers
          </Text>
          <Text size="xs" c="dimmed">
            No previous season data yet.
          </Text>
          <Button
            variant="light"
            size="xs"
            onClick={onOpenManualEntry}
            style={{ alignSelf: "flex-start" }}
          >
            Add last season's results
          </Button>
        </Stack>
      </Card>
    );
  }

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500}>
            Recommended Keepers
          </Text>
          <Anchor
            component="button"
            type="button"
            size="xs"
            onClick={onOpenManualEntry}
          >
            Edit last season's results
          </Anchor>
        </Group>
        <Select
          size="xs"
          value={teamFilter}
          onChange={(value) => setTeamFilter(value ?? ALL_TEAMS)}
          allowDeselect={false}
          data={[
            { value: ALL_TEAMS, label: "All Teams" },
            ...draftTeams.map((team) => ({
              value: team._id,
              label: team.isSelf ? `${team.name} (You)` : team.name,
            })),
            ...(orphanedTeamNames.length > 0
              ? [
                  {
                    group: "Last season (unmatched team name)",
                    items: orphanedTeamNames.map((name) => ({
                      value: `${HISTORY_PREFIX}${name}`,
                      label: name,
                    })),
                  },
                ]
              : []),
          ]}
        />
        {!keeperRules ? (
          <Text size="xs" c="dimmed">
            Configure keeper rules to see recommended keepers.
          </Text>
        ) : recommendations.length === 0 ? (
          <Text size="xs" c="dimmed">
            {selectedTeamName
              ? "No strong keeper values found for this team - try All Teams, or double-check last season's results have this team's roster confirmed."
              : "No strong keeper values found."}
          </Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              {isSnakeOrLinear
                ? "Best value vs. this year's projected fair round."
                : "Best value vs. this year's fair price."}
            </Text>
            <Table.ScrollContainer minWidth={320}>
              <Table verticalSpacing={4}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Player</Table.Th>
                    <Table.Th ta="right">Cost</Table.Th>
                    {/* Redundant with Saved (= Market - Cost) once space is
                        tight - Saved alone is the actionable number, so
                        this drops out below "sm" rather than forcing a
                        horizontal scroll for it. */}
                    <Table.Th ta="right" visibleFrom="sm">
                      Market
                    </Table.Th>
                    <Table.Th ta="right">Saved</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {recommendations.map(
                    ({
                      player,
                      teamName,
                      costValue,
                      costLabel,
                      marketLabel,
                      savingsLabel,
                    }) => (
                      <Table.Tr key={player.fpid}>
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
                            {player.team && (
                              <Text size="xs" c="dimmed">
                                {player.team}
                              </Text>
                            )}
                          </Group>
                          {teamName && (
                            <Text size="xs" c="dimmed">
                              Likely on: {teamName}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td ta="right">{costLabel}</Table.Td>
                        <Table.Td ta="right" visibleFrom="sm">
                          {marketLabel}
                        </Table.Td>
                        <Table.Td ta="right">
                          <Group gap={6} justify="flex-end" wrap="nowrap">
                            <Text size="sm" fw={600} c="teal">
                              {savingsLabel}
                            </Text>
                            <Anchor
                              component="button"
                              type="button"
                              size="xs"
                              onClick={() =>
                                onQuickAdd(
                                  player.fpid,
                                  player.position,
                                  costValue,
                                  teamName,
                                )
                              }
                            >
                              Add
                            </Anchor>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ),
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </>
        )}
      </Stack>
    </Card>
  );
}
