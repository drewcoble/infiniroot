import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { api } from "@infinidata/api";
import type { Doc } from "@infinidata/dataModel";
import {
  CountStepper,
  EditableNumberStepper,
} from "../../../components/NumberStepper";
import { POSITIONS, type Position } from "../../../types";
import { POSITION_COLORS } from "@shared/positionColors";
import {
  filterRelevantPlayers,
  pointsForScoringConfig,
} from "../../../lib/relevantPlayers";
import { WEEK } from "../../../constants/general";
import { DEFAULT_KEEPER_RULES } from "../../../constants/leagueSettings";
import type { KeeperRules } from "../../../lib/keeperCost";
import { KeeperTierPlayerPicker } from "./KeeperTierPlayerPicker";
import { getErrorMessage } from "@shared/errors";

interface KeeperRulesPanelProps {
  settings: Doc<"seasons">;
}

// Local editable draft shapes mirror the schema types but make every
// optional numeric field explicitly `| undefined` instead of `?:` -
// exactOptionalPropertyTypes (tsconfig.json) forbids assigning `undefined`
// to a `?:` field, which local edit state needs to do freely (e.g.
// "clearing" a NumberInput). buildFormula/buildDefaultFormula below strip
// undefined keys back out when constructing the actual mutation payload.
interface FormulaDraft {
  multiplier: number;
  flatAdd: number;
  minimumCost: number | undefined;
}

interface DefaultFormulaDraft extends FormulaDraft {
  undraftedCost: number | undefined;
}

// Round-denominated counterpart to FormulaDraft, edited instead of the
// dollar fields for a snake/linear league (SNAKE_DRAFT.md §8) - see
// isSnakeOrLinear below.
interface RoundFormulaDraft {
  roundsEarlier: number;
  minimumRound: number | undefined;
  undraftedRound: number | undefined;
}

interface TierDraft {
  id: string;
  name: string;
  maxSize: number | undefined;
  formula: FormulaDraft;
  roundFormula: RoundFormulaDraft;
  // Whole positions this rule also applies to, on top of the explicit
  // fpids list edited via KeeperTierPlayerPicker - see formulaForFpid.
  positions: Position[];
}

// crypto.randomUUID() only exists in secure contexts (HTTPS or localhost) -
// it's undefined when the app is opened over plain HTTP on a LAN IP (e.g.
// testing on a phone via http://192.168.x.x), which is a normal way to use
// this app during a draft. The id just needs to be unique within this
// tiers list, not cryptographically random, so fall back to a
// timestamp+random string instead of failing tier creation outright.
function generateTierId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toTierDrafts(tiers: KeeperRules["tiers"]): TierDraft[] {
  return tiers.map((t) => ({
    id: t.id,
    name: t.name,
    maxSize: t.maxSize,
    formula: {
      multiplier: t.formula.multiplier,
      flatAdd: t.formula.flatAdd,
      minimumCost: t.formula.minimumCost,
    },
    roundFormula: {
      roundsEarlier: t.roundFormula?.roundsEarlier ?? 1,
      minimumRound: t.roundFormula?.minimumRound,
      undraftedRound: t.roundFormula?.undraftedRound,
    },
    positions: t.positions ?? [],
  }));
}

function buildFormula(
  draft: FormulaDraft,
): KeeperRules["tiers"][number]["formula"] {
  return {
    multiplier: draft.multiplier,
    flatAdd: draft.flatAdd,
    ...(draft.minimumCost !== undefined
      ? { minimumCost: draft.minimumCost }
      : {}),
  };
}

function buildDefaultFormula(
  draft: DefaultFormulaDraft,
): KeeperRules["defaultFormula"] {
  return {
    ...buildFormula(draft),
    ...(draft.undraftedCost !== undefined
      ? { undraftedCost: draft.undraftedCost }
      : {}),
  };
}

function toRoundFormulaDraft(
  formula: KeeperRules["defaultRoundFormula"],
): RoundFormulaDraft {
  return {
    roundsEarlier: formula?.roundsEarlier ?? 1,
    minimumRound: formula?.minimumRound,
    undraftedRound: formula?.undraftedRound,
  };
}

function buildRoundFormula(
  draft: RoundFormulaDraft,
): NonNullable<KeeperRules["defaultRoundFormula"]> {
  return {
    roundsEarlier: draft.roundsEarlier,
    ...(draft.minimumRound !== undefined
      ? { minimumRound: draft.minimumRound }
      : {}),
    ...(draft.undraftedRound !== undefined
      ? { undraftedRound: draft.undraftedRound }
      : {}),
  };
}

// Comparable signature for "is the config dirty" / "should the local draft
// resync" that deliberately excludes each tier's `fpids` - those commit
// immediately via the per-tier player picker (its own mutation,
// setKeeperTierPlayers) rather than through this panel's batched Save, so a
// picker click shouldn't wipe out an in-progress formula edit or force a
// resync that discards it.
function definitionSignature(rules: {
  defaultFormula: DefaultFormulaDraft;
  defaultRoundFormula: RoundFormulaDraft;
  maxKeepersPerTeam: number | undefined;
  maxConsecutiveYears: number | undefined;
  roundConflictResolution: "earlier" | "later";
  tiers: TierDraft[];
}): string {
  return JSON.stringify(rules);
}

// Follows TeamsPanel's pattern: local dirty-tracked draft state, its own
// Save button + dirty/saved badge, own mutation. Player selection within
// each tier is the one exception - see KeeperTierPlayerPicker and
// definitionSignature above for why that's split out.
function toDefaultFormulaDraft(
  formula: KeeperRules["defaultFormula"],
): DefaultFormulaDraft {
  return {
    multiplier: formula.multiplier,
    flatAdd: formula.flatAdd,
    minimumCost: formula.minimumCost,
    undraftedCost: formula.undraftedCost,
  };
}

export function KeeperRulesPanel({ settings }: KeeperRulesPanelProps) {
  const keeperRules = settings.keeperRules ?? DEFAULT_KEEPER_RULES;
  // Round-based cost isn't a separate user-facing toggle - it follows the
  // league's draft type directly (SNAKE_DRAFT.md §8's assumption that a
  // snake/linear league always wants slot-denominated keeper cost, never a
  // $ formula, and vice versa for auction), same "derive from draftType"
  // pattern LeagueDetails.tsx's isSnakeOrLinear already uses.
  const isSnakeOrLinear = (settings.draftType ?? "auction") !== "auction";

  const [defaultFormula, setDefaultFormula] = useState<DefaultFormulaDraft>(
    toDefaultFormulaDraft(keeperRules.defaultFormula),
  );
  const [defaultRoundFormula, setDefaultRoundFormula] =
    useState<RoundFormulaDraft>(
      toRoundFormulaDraft(keeperRules.defaultRoundFormula),
    );
  const [maxKeepersPerTeam, setMaxKeepersPerTeam] = useState<
    number | undefined
  >(keeperRules.maxKeepersPerTeam);
  const [maxConsecutiveYears, setMaxConsecutiveYears] = useState<
    number | undefined
  >(keeperRules.maxConsecutiveYears);
  const [roundConflictResolution, setRoundConflictResolution] = useState<
    "earlier" | "later"
  >(keeperRules.roundConflictResolution ?? "earlier");
  const [tierDrafts, setTierDrafts] = useState<TierDraft[]>(
    toTierDrafts(keeperRules.tiers),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tierSearch, setTierSearch] = useState<Record<string, string>>({});

  const committedSignature = definitionSignature({
    defaultFormula: toDefaultFormulaDraft(keeperRules.defaultFormula),
    defaultRoundFormula: toRoundFormulaDraft(keeperRules.defaultRoundFormula),
    maxKeepersPerTeam: keeperRules.maxKeepersPerTeam,
    maxConsecutiveYears: keeperRules.maxConsecutiveYears,
    roundConflictResolution: keeperRules.roundConflictResolution ?? "earlier",
    tiers: toTierDrafts(keeperRules.tiers),
  });

  useEffect(() => {
    setDefaultFormula(toDefaultFormulaDraft(keeperRules.defaultFormula));
    setDefaultRoundFormula(
      toRoundFormulaDraft(keeperRules.defaultRoundFormula),
    );
    setMaxKeepersPerTeam(keeperRules.maxKeepersPerTeam);
    setMaxConsecutiveYears(keeperRules.maxConsecutiveYears);
    setRoundConflictResolution(keeperRules.roundConflictResolution ?? "earlier");
    setTierDrafts(toTierDrafts(keeperRules.tiers));
    // Only the definition signature (not the whole keeperRules object, which
    // also changes on every fpids-only picker click) should trigger a
    // resync - see definitionSignature's comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedSignature]);

  const localSignature = definitionSignature({
    defaultFormula,
    defaultRoundFormula,
    maxKeepersPerTeam,
    maxConsecutiveYears,
    roundConflictResolution,
    tiers: tierDrafts,
  });
  const isDirty = localSignature !== committedSignature;

  // Mobile-only - see the collapsible wrapper in the return below. Desktop
  // always shows the full section (there's room), so this state is simply
  // unused there.
  const [mobileOpened, { toggle: toggleMobileOpened }] = useDisclosure(false);

  const setKeeperRules = useMutation(api.draft.keeperRules.setKeeperRules);
  const setKeeperTierPlayers = useMutation(
    api.draft.keeperRules.setKeeperTierPlayers,
  );

  // Self-contained player search, same data sources KeepersTab uses, so the
  // per-tier picker can search/label players without LeagueDetails needing
  // to know anything about keeper rules.
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const allRankings = useQuery(api.rankings.getAllRankings, { week: WEEK });

  const activePositions = useMemo(() => {
    return POSITIONS.filter(
      (pos) =>
        settings.rosterSlots[pos] > 0 ||
        settings.flexPositions.includes(pos) ||
        settings.superflexPositions.includes(pos),
    );
  }, [settings]);

  const adpByFpid = useMemo(() => {
    const map = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const ranking of allRankings ?? []) map.set(ranking.fpid, ranking);
    return map;
  }, [allRankings]);

  const nameByFpid = useMemo(() => {
    const map = new Map<
      number,
      { fpid: number; name: string; position: Position; team: string | null }
    >();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, {
        fpid: row.fpid,
        name: row.name,
        position: row.position,
        team: row.team,
      });
    }
    return map;
  }, [allProjections]);

  const scoringConfig = useMemo(
    () => ({
      scoring: settings.scoring,
      teScoring: settings.teScoring ?? ("NONE" as const),
      sixPointPassTds: settings.sixPointPassTds ?? false,
    }),
    [settings.scoring, settings.teScoring, settings.sixPointPassTds],
  );

  const relevantPlayers = useMemo(() => {
    if (!allProjections) return [];
    return filterRelevantPlayers(
      allProjections,
      activePositions,
      settings.scoring,
      adpByFpid,
      (row) => pointsForScoringConfig(row, scoringConfig),
    );
  }, [
    allProjections,
    activePositions,
    settings.scoring,
    scoringConfig,
    adpByFpid,
  ]);

  const searchResultsForTier = (tierId: string) => {
    const query = (tierSearch[tierId] ?? "").trim().toLowerCase();
    if (query.length < 2) return [];
    return relevantPlayers
      .filter((row) => row.name.toLowerCase().includes(query))
      .slice(0, 8)
      .map((row) => ({
        fpid: row.fpid,
        name: row.name,
        position: row.position,
        team: row.team,
      }));
  };

  const otherTiersFpids = (tierId: string) => {
    const set = new Set<number>();
    for (const t of keeperRules.tiers) {
      if (t.id === tierId) continue;
      for (const fpid of t.fpids) set.add(fpid);
    }
    return set;
  };

  const handleToggleTierPlayer = async (tierId: string, fpid: number) => {
    const tier = keeperRules.tiers.find((t) => t.id === tierId);
    if (!tier) return;
    const nextFpids = tier.fpids.includes(fpid)
      ? tier.fpids.filter((id) => id !== fpid)
      : [...tier.fpids, fpid];
    setError(null);
    try {
      await setKeeperTierPlayers({
        seasonId: settings._id,
        tierId,
        fpids: nextFpids,
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update rule players."));
    }
  };

  const addTier = () => {
    setTierDrafts((current) => [
      ...current,
      {
        id: generateTierId(),
        name: `Rule ${current.length + 1}`,
        maxSize: undefined,
        formula: { multiplier: 1, flatAdd: 0, minimumCost: undefined },
        roundFormula: {
          roundsEarlier: 1,
          minimumRound: undefined,
          undraftedRound: undefined,
        },
        positions: [],
      },
    ]);
  };

  const removeTier = (id: string) => {
    setTierDrafts((current) => current.filter((t) => t.id !== id));
  };

  const updateTier = (id: string, patch: Partial<TierDraft>) => {
    setTierDrafts((current) =>
      current.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await setKeeperRules({
        seasonId: settings._id,
        keeperRules: {
          costMode: isSnakeOrLinear ? "round" : "dollar",
          // defaultFormula is required by the schema regardless of
          // costMode (SNAKE_DRAFT.md §8 doesn't drop the dollar formula,
          // just leaves it unused) - a snake/linear league still writes
          // whatever dollar draft it was seeded with, just never shows it.
          defaultFormula: buildDefaultFormula(defaultFormula),
          ...(isSnakeOrLinear
            ? { defaultRoundFormula: buildRoundFormula(defaultRoundFormula) }
            : {}),
          ...(maxKeepersPerTeam !== undefined ? { maxKeepersPerTeam } : {}),
          ...(maxConsecutiveYears !== undefined ? { maxConsecutiveYears } : {}),
          ...(isSnakeOrLinear ? { roundConflictResolution } : {}),
          tiers: tierDrafts.map((draft) => ({
            id: draft.id,
            name: draft.name,
            ...(draft.maxSize !== undefined ? { maxSize: draft.maxSize } : {}),
            formula: buildFormula(draft.formula),
            ...(isSnakeOrLinear
              ? { roundFormula: buildRoundFormula(draft.roundFormula) }
              : {}),
            // Preserve whatever fpids are currently live on the server for
            // this tier (edited independently via the picker) rather than
            // whatever this draft happened to be seeded with.
            fpids:
              keeperRules.tiers.find((t) => t.id === draft.id)?.fpids ?? [],
            positions: draft.positions,
          })),
        },
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save keeper rules."));
    } finally {
      setIsSaving(false);
    }
  };

  const body = (
    <>
      <Card withBorder padding="sm">
        <Group gap="sm" wrap="wrap">
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Max keepers per team
            </Text>
            <CountStepper
              label="Max keepers per team"
              min={0}
              placeholder="Unlimited"
              nullable
              value={maxKeepersPerTeam}
              onChange={setMaxKeepersPerTeam}
            />
          </Stack>
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Max consecutive years kept
            </Text>
            <CountStepper
              label="Max consecutive years kept"
              min={1}
              placeholder="Unlimited"
              nullable
              value={maxConsecutiveYears}
              onChange={setMaxConsecutiveYears}
            />
          </Stack>
          {isSnakeOrLinear && (
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                If two keepers land on the same round
              </Text>
              <SegmentedControl
                value={roundConflictResolution}
                onChange={(value) =>
                  setRoundConflictResolution(value as "earlier" | "later")
                }
                data={[
                  { label: "Move earlier (pricier)", value: "earlier" },
                  { label: "Move later (cheaper)", value: "later" },
                ]}
              />
            </Stack>
          )}
        </Group>
      </Card>

      <Card withBorder padding="sm">
        <Stack gap="xs">
          <Text size="md" fw={500}>
            Default rule
          </Text>
          {isSnakeOrLinear ? (
            <>
              <Text size="xs" c="dimmed">
                Cost = last season's round − rounds earlier per year kept
              </Text>
              <Group gap="sm" wrap="wrap">
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Rounds earlier per year kept
                  </Text>
                  <EditableNumberStepper
                    label="Rounds earlier per year kept"
                    size="sm"
                    width={140}
                    value={defaultRoundFormula.roundsEarlier}
                    onChange={(v) =>
                      setDefaultRoundFormula((f) => ({
                        ...f,
                        roundsEarlier: v ?? 0,
                      }))
                    }
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Minimum round
                  </Text>
                  <EditableNumberStepper
                    label="Minimum round"
                    size="sm"
                    width={120}
                    min={1}
                    placeholder="1"
                    nullable
                    value={defaultRoundFormula.minimumRound}
                    onChange={(v) =>
                      setDefaultRoundFormula((f) => ({
                        ...f,
                        minimumRound: v,
                      }))
                    }
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Undrafted player round
                  </Text>
                  <EditableNumberStepper
                    label="Undrafted player round"
                    size="sm"
                    width={140}
                    min={1}
                    placeholder="Manual entry"
                    nullable
                    value={defaultRoundFormula.undraftedRound}
                    onChange={(v) =>
                      setDefaultRoundFormula((f) => ({
                        ...f,
                        undraftedRound: v,
                      }))
                    }
                  />
                </Stack>
              </Group>
            </>
          ) : (
            <>
              <Text size="xs" c="dimmed">
                Cost = multiplier × last season's price + flat add
              </Text>
              <Group gap="sm" wrap="wrap">
                <NumberInput
                  label="Multiplier"
                  size="sm"
                  w={110}
                  step={0.1}
                  value={defaultFormula.multiplier}
                  onChange={(v) =>
                    setDefaultFormula((f) => ({
                      ...f,
                      multiplier: Number(v) || 0,
                    }))
                  }
                />
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Flat add ($)
                  </Text>
                  <EditableNumberStepper
                    label="Flat add"
                    size="sm"
                    width={110}
                    prefix="$"
                    value={defaultFormula.flatAdd}
                    onChange={(v) =>
                      setDefaultFormula((f) => ({ ...f, flatAdd: v ?? 0 }))
                    }
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Minimum ($)
                  </Text>
                  <EditableNumberStepper
                    label="Minimum"
                    size="sm"
                    width={110}
                    prefix="$"
                    placeholder="None"
                    nullable
                    value={defaultFormula.minimumCost}
                    onChange={(v) =>
                      setDefaultFormula((f) => ({ ...f, minimumCost: v }))
                    }
                  />
                </Stack>
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    Undrafted player cost ($)
                  </Text>
                  <EditableNumberStepper
                    label="Undrafted player cost"
                    size="sm"
                    width={140}
                    prefix="$"
                    placeholder="Manual entry"
                    nullable
                    value={defaultFormula.undraftedCost}
                    onChange={(v) =>
                      setDefaultFormula((f) => ({ ...f, undraftedCost: v }))
                    }
                  />
                </Stack>
              </Group>
            </>
          )}
        </Stack>
      </Card>

      <Stack gap="xs">
        <Group justify="space-between">
          <Text size="md" fw={500}>
            Other rules
          </Text>
          <Button
            size="xs"
            variant="default"
            leftSection={<Plus size={14} />}
            onClick={addTier}
          >
            Add rule
          </Button>
        </Group>
        {tierDrafts.length === 0 ? (
          <Text size="xs" c="dimmed">
            No other rules - every player uses the default rule above.
          </Text>
        ) : (
          tierDrafts.map((tier) => {
            const liveTier = keeperRules.tiers.find((t) => t.id === tier.id);
            const liveFpids = liveTier?.fpids ?? [];
            // Player selection commits immediately through its own mutation
            // (setKeeperTierPlayers via handleToggleTierPlayer above),
            // separate from this panel's batched Save - but that mutation
            // only knows how to patch an EXISTING server-side tier. A
            // brand-new rule (via addTier) only exists in local tierDrafts
            // until Save Keeper Rules persists it, so toggling a player
            // before that point was a silent no-op. Gate the picker on that
            // instead of leaving it looking functional but doing nothing.
            const isSaved = liveTier !== undefined;
            return (
              <Card key={tier.id} withBorder padding="sm">
                <Stack gap="xs">
                  <Group gap="sm" wrap="wrap" align="flex-end">
                    <TextInput
                      label="Rule name"
                      size="sm"
                      w={200}
                      value={tier.name}
                      onChange={(e) =>
                        updateTier(tier.id, {
                          name: e.currentTarget.value,
                        })
                      }
                    />
                    <Stack gap={4}>
                      <Text size="sm" fw={500}>
                        Max size
                      </Text>
                      <CountStepper
                        label="Max size"
                        min={1}
                        placeholder="Unlimited"
                        nullable
                        value={tier.maxSize}
                        onChange={(v) => updateTier(tier.id, { maxSize: v })}
                      />
                    </Stack>
                    {isSnakeOrLinear ? (
                      <>
                        <Stack gap={4}>
                          <Text size="sm" fw={500}>
                            Rounds earlier/yr
                          </Text>
                          <EditableNumberStepper
                            label="Rounds earlier per year kept"
                            size="sm"
                            width={110}
                            value={tier.roundFormula.roundsEarlier}
                            onChange={(v) =>
                              updateTier(tier.id, {
                                roundFormula: {
                                  ...tier.roundFormula,
                                  roundsEarlier: v ?? 0,
                                },
                              })
                            }
                          />
                        </Stack>
                        <Stack gap={4}>
                          <Text size="sm" fw={500}>
                            Minimum round
                          </Text>
                          <EditableNumberStepper
                            label="Minimum round"
                            size="sm"
                            width={110}
                            min={1}
                            placeholder="1"
                            nullable
                            value={tier.roundFormula.minimumRound}
                            onChange={(v) =>
                              updateTier(tier.id, {
                                roundFormula: {
                                  ...tier.roundFormula,
                                  minimumRound: v,
                                },
                              })
                            }
                          />
                        </Stack>
                        <Stack gap={4}>
                          <Text size="sm" fw={500}>
                            Undrafted round
                          </Text>
                          <EditableNumberStepper
                            label="Undrafted player round"
                            size="sm"
                            width={110}
                            min={1}
                            placeholder="Manual"
                            nullable
                            value={tier.roundFormula.undraftedRound}
                            onChange={(v) =>
                              updateTier(tier.id, {
                                roundFormula: {
                                  ...tier.roundFormula,
                                  undraftedRound: v,
                                },
                              })
                            }
                          />
                        </Stack>
                      </>
                    ) : (
                      <>
                        <NumberInput
                          label="Multiplier"
                          size="sm"
                          w={100}
                          step={0.1}
                          value={tier.formula.multiplier}
                          onChange={(v) =>
                            updateTier(tier.id, {
                              formula: {
                                ...tier.formula,
                                multiplier: Number(v) || 0,
                              },
                            })
                          }
                        />
                        <Stack gap={4}>
                          <Text size="sm" fw={500}>
                            Flat add ($)
                          </Text>
                          <EditableNumberStepper
                            label="Flat add"
                            size="sm"
                            width={100}
                            prefix="$"
                            value={tier.formula.flatAdd}
                            onChange={(v) =>
                              updateTier(tier.id, {
                                formula: { ...tier.formula, flatAdd: v ?? 0 },
                              })
                            }
                          />
                        </Stack>
                        <Stack gap={4}>
                          <Text size="sm" fw={500}>
                            Minimum ($)
                          </Text>
                          <EditableNumberStepper
                            label="Minimum"
                            size="sm"
                            width={100}
                            prefix="$"
                            placeholder="None"
                            nullable
                            value={tier.formula.minimumCost}
                            onChange={(v) =>
                              updateTier(tier.id, {
                                formula: { ...tier.formula, minimumCost: v },
                              })
                            }
                          />
                        </Stack>
                      </>
                    )}
                    <ActionIcon
                      variant="default"
                      color="red"
                      size={36}
                      onClick={() => removeTier(tier.id)}
                      aria-label={`Remove ${tier.name}`}
                    >
                      <Trash2 size={14} />
                    </ActionIcon>
                  </Group>
                  <Stack gap={4}>
                    <Text size="sm" fw={500}>
                      Positions
                    </Text>
                    <Chip.Group
                      multiple
                      value={tier.positions}
                      onChange={(value) =>
                        updateTier(tier.id, { positions: value as Position[] })
                      }
                    >
                      <Group gap="xs">
                        {POSITIONS.map((pos) => (
                          <Chip
                            key={pos}
                            value={pos}
                            color={POSITION_COLORS[pos]}
                          >
                            {pos}
                          </Chip>
                        ))}
                      </Group>
                    </Chip.Group>
                  </Stack>
                  {isSaved ? (
                    <>
                      <Text size="xs" c="dimmed">
                        Players ({liveFpids.length}
                        {tier.maxSize !== undefined ? `/${tier.maxSize}` : ""})
                      </Text>
                      <KeeperTierPlayerPicker
                        fpids={liveFpids}
                        maxSize={tier.maxSize}
                        otherTiersFpids={otherTiersFpids(tier.id)}
                        nameByFpid={nameByFpid}
                        searchResults={searchResultsForTier(tier.id)}
                        search={tierSearch[tier.id] ?? ""}
                        onSearchChange={(value) =>
                          setTierSearch((current) => ({
                            ...current,
                            [tier.id]: value,
                          }))
                        }
                        onToggle={(fpid) =>
                          handleToggleTierPlayer(tier.id, fpid)
                        }
                      />
                    </>
                  ) : (
                    <Text size="xs" c="dimmed">
                      Save to add players to this rule.
                    </Text>
                  )}
                </Stack>
              </Card>
            );
          })
        )}
      </Stack>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}
      <Group gap="xs">
        <Button
          size="md"
          onClick={handleSave}
          loading={isSaving}
          disabled={!isDirty}
        >
          Save Keeper Rules
        </Button>
        <Badge variant="light" color={isDirty ? "yellow" : "teal"}>
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </Badge>
      </Group>
    </>
  );

  return (
    <>
      {/* Desktop: always expanded, no toggle - there's room for it in the
          two-column Settings layout. */}
      <Box visibleFrom="sm">
        <Stack gap="sm">
          <Text size="md" fw={500}>
            Keeper Rules
          </Text>
          {body}
        </Stack>
      </Box>
      {/* Mobile: collapsed by default - this is a dense, one-time-setup
          section (formulas, per-rule player pickers), not something worth
          the scroll distance on every visit to the Settings tab. */}
      <Box hiddenFrom="sm">
        <Stack gap="sm">
          <UnstyledButton
            onClick={toggleMobileOpened}
            aria-expanded={mobileOpened}
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="md" fw={500}>
                Keeper Rules
              </Text>
              {mobileOpened ? (
                <ChevronUp size={16} />
              ) : (
                <ChevronDown size={16} />
              )}
            </Group>
          </UnstyledButton>
          <Collapse in={mobileOpened}>
            <Stack gap="sm">{body}</Stack>
          </Collapse>
        </Stack>
      </Box>
    </>
  );
}
