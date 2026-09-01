import { useRef, useState } from "react";
import {
  Anchor,
  Badge,
  Button,
  Card,
  CloseButton,
  Combobox,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useCombobox,
} from "@mantine/core";
import type { Doc, Id } from "@infinidata/dataModel";
import { EditableNumberStepper } from "../../../components/NumberStepper";
import { RookieBadge } from "@shared/RookieBadge";
import type { Position } from "../../../types";
import { POSITION_COLORS } from "@shared/positionColors";
import {
  computeKeeperCost,
  computeKeeperCostRound,
  formulaForFpid,
  roundFormulaForFpid,
  type KeeperPriceHistoryEntry,
  type KeeperRules,
} from "../../../lib/keeperCost";

interface KeeperSearchResult {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

// Suggested keeper cost for one candidate, branching on format the same way
// KeeperRulesPanel's Save payload does (SNAKE_DRAFT.md §8) - null whenever
// there's nothing to base a suggestion on (no rules configured yet, or a
// snake/linear league that hasn't set up a round formula), same "fall back
// to manual entry" signal computeKeeperCost/computeKeeperCostRound use.
function resolveSuggestedCost(
  keeperRules: KeeperRules | undefined,
  fpid: number,
  position: Position,
  lastSeason: KeeperPriceHistoryEntry | undefined,
  isSnakeOrLinear: boolean,
): number | null {
  if (!keeperRules) return null;
  if (isSnakeOrLinear) {
    const formula = roundFormulaForFpid(keeperRules, fpid, position);
    return formula ? computeKeeperCostRound(formula, lastSeason?.round) : null;
  }
  return computeKeeperCost(
    formulaForFpid(keeperRules, fpid, position),
    lastSeason?.price,
  );
}

interface KeeperSearchFormProps {
  keeperSearch: string;
  onKeeperSearchChange: (value: string) => void;
  draftTeams: Doc<"seasonTeams">[];
  keeperTeamId: Id<"seasonTeams"> | null;
  onKeeperTeamIdChange: (id: Id<"seasonTeams"> | null) => void;
  keeperPrice: number;
  onKeeperPriceChange: (price: number) => void;
  keeperError: string | null;
  keeperSearchResults: KeeperSearchResult[];
  rookieFpids: Set<number>;
  draftValueByFpid: Map<number, { dollarValue: number }>;
  priceHistory: Record<number, KeeperPriceHistoryEntry> | undefined;
  keeperRules: KeeperRules | undefined;
  // A snake/linear league's keeper cost is a draft-slot round, not a dollar
  // price (SNAKE_DRAFT.md §8) - branches the suggested-cost formula, the
  // last-season summary line, and the Cost/Round input's label below.
  isSnakeOrLinear: boolean;
  atTeamKeeperCap: boolean;
  onAddKeeper: (fpid: number, position: Position, price: number) => void;
  onSelectPlayer: (fpid: number) => void;
}

// Step-by-step keeper flow: search -> pick a player from the dropdown ->
// set team/cost for that one player -> Save. Replaces the old layout where
// every search match got its own always-live "Add as Keeper" button, which
// made it easy to add the wrong row's price/team combo by mistake.
export function KeeperSearchForm({
  keeperSearch,
  onKeeperSearchChange,
  draftTeams,
  keeperTeamId,
  onKeeperTeamIdChange,
  keeperPrice,
  onKeeperPriceChange,
  keeperError,
  keeperSearchResults,
  rookieFpids,
  draftValueByFpid,
  priceHistory,
  keeperRules,
  isSnakeOrLinear,
  atTeamKeeperCap,
  onAddKeeper,
  onSelectPlayer,
}: KeeperSearchFormProps) {
  const [selectedCandidate, setSelectedCandidate] =
    useState<KeeperSearchResult | null>(null);
  // Blurred once a player's picked from the dropdown so the on-screen
  // keyboard on iOS/Android doesn't stick around covering the team/cost
  // fields that appear next.
  const inputRef = useRef<HTMLInputElement>(null);

  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const clearSelection = () => {
    setSelectedCandidate(null);
    onKeeperSearchChange("");
  };

  const handleOptionSubmit = (value: string) => {
    const candidate = keeperSearchResults.find(
      (row) => String(row.fpid) === value,
    );
    combobox.closeDropdown();
    inputRef.current?.blur();
    if (!candidate) return;
    setSelectedCandidate(candidate);
    onKeeperSearchChange(candidate.name);
    const lastSeason = priceHistory?.[candidate.fpid];
    const suggestedCost = resolveSuggestedCost(
      keeperRules,
      candidate.fpid,
      candidate.position,
      lastSeason,
      isSnakeOrLinear,
    );
    onKeeperPriceChange(suggestedCost ?? 1);
  };

  const lastSeason = selectedCandidate
    ? priceHistory?.[selectedCandidate.fpid]
    : undefined;
  const fairValue = selectedCandidate
    ? draftValueByFpid.get(selectedCandidate.fpid)
    : undefined;
  const suggestedCost = selectedCandidate
    ? resolveSuggestedCost(
        keeperRules,
        selectedCandidate.fpid,
        selectedCandidate.position,
        lastSeason,
        isSnakeOrLinear,
      )
    : null;

  const disabled = !keeperTeamId || atTeamKeeperCap;

  return (
    <Stack gap="sm">
      <Combobox store={combobox} onOptionSubmit={handleOptionSubmit}>
        <Combobox.Target>
          <TextInput
            ref={inputRef}
            label="Search a player to keep..."
            placeholder="e.g. CeeDee Lamb"
            value={keeperSearch}
            // iOS's autocorrect/QuickType bar doesn't recognize most player
            // surnames and pops a suggestion strip on top of the dropdown
            // below, eating the first tap on an option - see
            // ManualPreviousSeasonModal.tsx's copy of this same fix.
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setSelectedCandidate(null);
              onKeeperSearchChange(event.currentTarget.value);
              combobox.openDropdown();
              combobox.updateSelectedOptionIndex();
            }}
            onClick={() => combobox.openDropdown()}
            onFocus={() => combobox.openDropdown()}
            onBlur={() => combobox.closeDropdown()}
            rightSection={
              selectedCandidate ? (
                <CloseButton
                  size="sm"
                  aria-label="Clear selected player"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearSelection}
                />
              ) : undefined
            }
          />
        </Combobox.Target>

        <Combobox.Dropdown>
          <Combobox.Options mah={280} style={{ overflowY: "auto" }}>
            {keeperSearchResults.length === 0 ? (
              <Combobox.Empty>
                {keeperSearch.trim().length < 2
                  ? "Type at least 2 characters..."
                  : "No players found"}
              </Combobox.Empty>
            ) : (
              keeperSearchResults.map((row) => (
                <Combobox.Option value={String(row.fpid)} key={row.fpid}>
                  <Group justify="space-between" wrap="nowrap" gap="sm">
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm">{row.name}</Text>
                      {rookieFpids.has(row.fpid) && <RookieBadge />}
                      <Badge
                        size="sm"
                        variant="light"
                        color={POSITION_COLORS[row.position]}
                      >
                        {row.position}
                      </Badge>
                      {row.team && (
                        <Text size="xs" c="dimmed">
                          {row.team}
                        </Text>
                      )}
                    </Group>
                    {!isSnakeOrLinear && draftValueByFpid.get(row.fpid) && (
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        ~$
                        {Math.round(
                          draftValueByFpid.get(row.fpid)!.dollarValue,
                        )}
                      </Text>
                    )}
                  </Group>
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </Combobox.Dropdown>
      </Combobox>

      {keeperError && (
        <Text c="red" size="sm">
          {keeperError}
        </Text>
      )}

      {selectedCandidate && (
        <Card withBorder padding="sm" radius="md">
          <Stack gap="sm">
            <Group gap={6} wrap="nowrap">
              <Anchor
                component="button"
                type="button"
                fw={500}
                onClick={() => onSelectPlayer(selectedCandidate.fpid)}
              >
                {selectedCandidate.name}
              </Anchor>
              {rookieFpids.has(selectedCandidate.fpid) && <RookieBadge />}
              <Badge
                variant="light"
                color={POSITION_COLORS[selectedCandidate.position]}
              >
                {selectedCandidate.position}
              </Badge>
              {selectedCandidate.team && (
                <Text size="xs" c="dimmed">
                  {selectedCandidate.team}
                </Text>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {!isSnakeOrLinear && fairValue
                ? `Fair ~$${Math.round(fairValue.dollarValue)}`
                : null}
              {isSnakeOrLinear
                ? lastSeason && lastSeason.round !== undefined
                  ? ` · Last kept round ${lastSeason.round}${
                      lastSeason.season ? ` (${lastSeason.season})` : ""
                    }`
                  : null
                : lastSeason && lastSeason.price !== undefined
                  ? ` · Last kept $${lastSeason.price}${
                      lastSeason.season ? ` (${lastSeason.season})` : ""
                    }`
                  : null}
              {suggestedCost !== null
                ? ` · Suggested ${isSnakeOrLinear ? `round ${suggestedCost}` : `$${suggestedCost}`}`
                : null}
            </Text>
            <Group grow align="flex-end">
              <Select
                label="Team"
                data={draftTeams.map((team) => ({
                  value: team._id,
                  label: team.name,
                }))}
                value={keeperTeamId}
                onChange={(value) =>
                  onKeeperTeamIdChange(value as Id<"seasonTeams"> | null)
                }
              />
              <Stack gap={4}>
                <Text size="sm" fw={500}>
                  {isSnakeOrLinear ? "Round" : "Cost"}
                </Text>
                <EditableNumberStepper
                  label={isSnakeOrLinear ? "Round" : "Cost"}
                  min={1}
                  {...(isSnakeOrLinear ? {} : { prefix: "$" })}
                  value={keeperPrice}
                  onChange={(value) => onKeeperPriceChange(value ?? 1)}
                />
              </Stack>
            </Group>
            <Tooltip
              label="This team already has the max number of keepers allowed."
              disabled={!atTeamKeeperCap}
            >
              <Button
                size="md"
                fullWidth
                disabled={disabled}
                onClick={() => {
                  onAddKeeper(
                    selectedCandidate.fpid,
                    selectedCandidate.position,
                    keeperPrice,
                  );
                  setSelectedCandidate(null);
                }}
              >
                Save Keeper
              </Button>
            </Tooltip>
          </Stack>
        </Card>
      )}
    </Stack>
  );
}
