import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Grid,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { POSITIONS, type OverspendBehavior, type Position } from "../types";
import { expandRosterSlots, type SlotDescriptor } from "../lib/rosterSlots";
import {
  DEFAULT_OVERSPEND_BEHAVIOR,
  generatePresetAmounts,
  type BudgetPreset,
} from "../lib/budgetPresets";
import { categoryForSlot } from "../lib/budgetCategories";
import { resolveTeamSalaryCap } from "../lib/teamBudget";
import { scoringConfigFromSeason } from "../lib/relevantPlayers";
import {
  unallocatedBadgeColor,
  unallocatedBadgeLabel,
} from "../lib/unallocatedBadge";
import { CATEGORY_ORDER } from "../constants/budget";
import {
  BUDGET_UNALLOCATED_BAR_HEIGHT,
  MOBILE_STATS_ROW_HEIGHT,
  WEEK,
} from "../constants/general";
import { MOBILE_HEADER_HEIGHT } from "@shared/constants";
import { PlayerDetailModal } from "./PlayerDetailModal";
import { GenericValuesNotice } from "./GenericValuesNotice";
import {
  SlotRow,
  type FilledSlotPlayer,
  type SlotPositionPreference,
} from "./BudgetTab/SlotRow";
import { CategoryBreakdown } from "./BudgetTab/CategoryBreakdown";
import { BudgetSidePanel } from "./BudgetTab/BudgetSidePanel";
import { UnallocatedBar } from "./BudgetTab/UnallocatedBar";
import { getErrorMessage } from "@shared/errors";

// Bench spots are almost never used to stash a kicker or defense - excluded
// here so BENCH's "closest priced players" popover only ever suggests
// skill-position players.
const BENCH_POSITIONS: readonly Position[] = POSITIONS.filter(
  (pos) => pos !== "DST" && pos !== "K",
);

const NO_FALLBACK: readonly Position[] = [];

// Which positions a slot's "closest priced players" popover (see SlotRow)
// should draw from - an exact position for a dedicated slot, the league's
// FLEX/SUPERFLEX eligibility lists for those, or BENCH_POSITIONS (everyone
// except DST/K) for BENCH. Mirrors the position-matching rules in
// src/lib/slotAssignment.ts's eligibleSlotsForPosition, just inverted
// (slot -> positions instead of position -> slots).
//
// SFLEX is the one slot with a real fallback tier: superflex exists mainly
// for QB scarcity, so it prefers QB, but falls back to the league's regular
// FLEX-eligible positions (RB/WR/TE) if there aren't enough QBs near the
// budgeted amount to fill the list - see SlotRow's closestPlayers.
function eligiblePositionsForSlot(
  slot: SlotDescriptor,
  flexPositions: readonly Position[],
  superflexPositions: readonly Position[],
): SlotPositionPreference {
  if (slot.position) return { primary: [slot.position], fallback: NO_FALLBACK };
  if (slot.label.startsWith("SFLEX")) {
    return superflexPositions.includes("QB")
      ? { primary: ["QB"], fallback: flexPositions }
      : { primary: superflexPositions, fallback: NO_FALLBACK };
  }
  if (slot.label.startsWith("FLEX")) {
    return { primary: flexPositions, fallback: NO_FALLBACK };
  }
  return { primary: BENCH_POSITIONS, fallback: NO_FALLBACK };
}

// "predraft" edits draftBudgetPlans directly (the Setup app's Budget tab -
// the baseline, editable anytime, carried forward by cloneDraftSettings).
// "live" edits draftLiveBudgetOverrides (the Draft Room's Budget tab) - only
// the slots actually touched here get saved; everything else keeps
// mirroring whatever the pre-draft plan currently says, live, for the rest
// of the draft.
interface BudgetTabProps {
  seasonId: Id<"seasons">;
  mode: "predraft" | "live";
}

export function BudgetTab({ seasonId, mode }: BudgetTabProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const teams = useQuery(api.infinidraft.draft.teams.listSeasonTeams, { seasonId });
  // Keepers are draftPicks rows too (see convex/draft/picks.ts's addKeeper),
  // so this is populated even in "predraft" mode, before the live draft
  // starts - a self-team keeper already spoken for a slot, and that's worth
  // surfacing on the pre-draft plan same as an in-draft pick.
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  const predraftPlan = useQuery(api.infinidraft.draft.plan.getBudgetPlan, {
    seasonId,
  });
  const livePlan = useQuery(
    api.infinidraft.draft.plan.getLiveBudgetPlan,
    mode === "live" ? { seasonId } : "skip",
  );
  const upsertBudgetPlan = useMutation(api.infinidraft.draft.plan.upsertBudgetPlan);
  const upsertLiveBudgetOverrides = useMutation(
    api.infinidraft.draft.plan.upsertLiveBudgetOverrides,
  );
  const resetLiveBudgetPlan = useMutation(api.infinidraft.draft.plan.resetLiveBudgetPlan);

  const settings = settingsList?.find((s) => s._id === seasonId);
  const selfTeam = teams?.find((t) => t.isSelf);
  // Feeds each SlotRow's "closest priced players" popover - same $ value
  // engine the rest of the app uses, which already excludes keepers (see
  // convex/draftValues.ts) from its output entirely.
  const draftValuesResult = useQuery(
    api.draftValues.getDraftValues,
    settings
      ? {
          seasonId,
          week: WEEK,
          scoringConfig: scoringConfigFromSeason(settings),
        }
      : "skip",
  );
  const draftValues = draftValuesResult?.values;
  const usingGenericValues = draftValuesResult?.isGeneric ?? false;
  // Name lookup for a filled slot's assigned player (see filledSlotPlayers
  // below) - unlike draftValues, this isn't drafted/kept-filtered, so it
  // covers keepers too.
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const nameByFpid = useMemo(() => {
    const map = new Map<number, { name: string }>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, row);
    }
    return map;
  }, [allProjections]);

  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const [overspendBehavior, setOverspendBehavior] = useState<OverspendBehavior>(
    DEFAULT_OVERSPEND_BEHAVIOR,
  );
  // Only meaningful in live mode - the slot keys the user has explicitly
  // reallocated this draft. Everything else keeps reading from
  // predraftPlan.amounts, live, so a pre-draft edit made mid-draft still
  // flows through for any slot nobody has touched yet.
  const [touchedKeys, setTouchedKeys] = useState<Set<string>>(new Set());
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The last-persisted amounts/behavior, so the Save button's dirty state
  // can be judged against "what the server actually has" rather than just
  // "has this been touched since mount" - null means nothing's been saved
  // for this plan yet, which is always dirty.
  const [savedSnapshot, setSavedSnapshot] = useState<{
    amounts: Record<string, number>;
    overspendBehavior: OverspendBehavior;
  } | null>(null);
  // Which Starter Budget button (if any) should read as "selected" - see
  // activePreset below, which derives that reactively by comparing amounts
  // against this preset's own generated shape, rather than this flag being
  // cleared explicitly on every edit.
  const [lastAppliedPreset, setLastAppliedPreset] =
    useState<BudgetPreset | null>(null);

  // Seed the form once, after which further refetches (e.g. from another
  // tab, or a live-mirrored pre-draft edit) shouldn't clobber whatever the
  // user is actively editing - "Reset to pre-draft plan" is the explicit,
  // deliberate way back to the current baseline instead.
  useEffect(() => {
    if (isInitialized || !settings || !teams) return;
    const effectiveSalaryCap = resolveTeamSalaryCap(
      selfTeam,
      settings.salaryCap,
    );
    if (mode === "predraft") {
      if (predraftPlan === undefined) return;
      if (predraftPlan) {
        setAmounts({ ...predraftPlan.amounts });
        setOverspendBehavior(predraftPlan.overspendBehavior);
        setSavedSnapshot({
          amounts: { ...predraftPlan.amounts },
          overspendBehavior: predraftPlan.overspendBehavior,
        });
      } else {
        // No pre-draft plan saved yet - start every slot at $0 rather than
        // pre-seeding a preset, so the user picks a starting shape
        // deliberately instead of being nudged away from the presets, and
        // so the Save button doesn't show "unsaved changes" before they've
        // touched anything.
        setAmounts({});
        setSavedSnapshot({
          amounts: {},
          overspendBehavior: DEFAULT_OVERSPEND_BEHAVIOR,
        });
      }
    } else {
      if (livePlan === undefined) return;
      if (livePlan) {
        setAmounts({ ...livePlan.amounts });
        setOverspendBehavior(livePlan.overspendBehavior);
        setTouchedKeys(new Set(livePlan.overriddenKeys));
        setSavedSnapshot({
          amounts: { ...livePlan.amounts },
          overspendBehavior: livePlan.overspendBehavior,
        });
      } else {
        // No pre-draft plan and no live overrides exist yet - nothing to
        // mirror, so every slot the balanced preset lands on still has to
        // be saved explicitly (as a live override) rather than treated as
        // "following pre-draft" once the user does save. But landing on
        // this tab and having it auto-seed a preset isn't itself a change
        // the user made, so it counts as the saved baseline too - avoids
        // the dirty-state badge reading "unsaved changes" before anyone's
        // touched anything.
        const preset = generatePresetAmounts(
          "balanced",
          settings.rosterSlots,
          effectiveSalaryCap,
        );
        setAmounts(preset);
        setTouchedKeys(new Set(Object.keys(preset)));
        setSavedSnapshot({
          amounts: { ...preset },
          overspendBehavior: DEFAULT_OVERSPEND_BEHAVIOR,
        });
      }
    }
    setIsInitialized(true);
  }, [isInitialized, settings, teams, selfTeam, mode, predraftPlan, livePlan]);

  const slots = useMemo(
    () => (settings ? expandRosterSlots(settings.rosterSlots) : []),
    [settings],
  );

  // Which of the self team's roster slots already have a player in them
  // (live pick or keeper), and who/what was actually paid - see SlotRow's
  // isFilled/mismatch styling (price vs. the slot's budgeted amount) and its
  // popover, which shows this player instead of the closest-available list
  // once a slot's filled.
  const filledSlotPlayers = useMemo(() => {
    if (!selfTeam) return new Map<string, FilledSlotPlayer>();
    const map = new Map<string, FilledSlotPlayer>();
    for (const pick of picks ?? []) {
      if (pick.teamId !== selfTeam._id || !pick.planSlotKey) continue;
      map.set(pick.planSlotKey, {
        fpid: pick.fpid,
        name: nameByFpid.get(pick.fpid)?.name ?? `Player ${pick.fpid}`,
        position: pick.position,
        // Budget planning is auction-only (SNAKE_DRAFT.md §3.4) - price is
        // always real here in practice.
        price: pick.price ?? 0,
      });
    }
    return map;
  }, [picks, selfTeam, nameByFpid]);

  // Every drafted-value row not already off the board - keepers are already
  // excluded by getDraftValues itself (see the query comment above), so this
  // only needs to additionally drop live auction picks.
  const draftedFpids = useMemo(
    () => new Set((picks ?? []).map((pick) => pick.fpid)),
    [picks],
  );
  const availablePlayers = useMemo(
    () => (draftValues ?? []).filter((row) => !draftedFpids.has(row.fpid)),
    [draftValues, draftedFpids],
  );

  // Regenerated only when the applied preset or the league's own shape
  // changes, not on every render/keystroke - activePreset below compares
  // this against the live `amounts` to decide whether the preset's button
  // should still read as selected.
  const lastAppliedPresetAmounts = useMemo(() => {
    if (!lastAppliedPreset || !settings) return null;
    return generatePresetAmounts(
      lastAppliedPreset,
      settings.rosterSlots,
      resolveTeamSalaryCap(selfTeam, settings.salaryCap),
    );
  }, [lastAppliedPreset, settings, selfTeam]);

  if (!settings || !teams || !isInitialized) {
    return null;
  }

  const effectiveSalaryCap = resolveTeamSalaryCap(selfTeam, settings.salaryCap);

  const totalAllocated = slots.reduce(
    (sum, slot) => sum + (amounts[slot.key] ?? 0),
    0,
  );
  const unallocated = effectiveSalaryCap - totalAllocated;
  const maxAmount = Math.max(1, ...slots.map((slot) => amounts[slot.key] ?? 0));
  const starterSlots = slots.filter((slot) => !slot.label.startsWith("BN"));
  const perStarter = starterSlots.length
    ? starterSlots.reduce((sum, slot) => sum + (amounts[slot.key] ?? 0), 0) /
      starterSlots.length
    : 0;
  // $ per roster spot is always just salaryCap / slots.length regardless of
  // how the budget is actually shaped - not a useful sanity check. $ per
  // bench player is the real comparison point against perStarter above,
  // since it reflects the actual amounts, not just slot counts.
  const benchSlots = slots.filter((slot) => slot.label.startsWith("BN"));
  const perBench = benchSlots.length
    ? benchSlots.reduce((sum, slot) => sum + (amounts[slot.key] ?? 0), 0) /
      benchSlots.length
    : 0;
  const topThreeTotal = [...slots]
    .map((slot) => amounts[slot.key] ?? 0)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((sum, v) => sum + v, 0);
  const topThreePct = effectiveSalaryCap
    ? Math.round((topThreeTotal / effectiveSalaryCap) * 100)
    : 0;
  const everySlotHasADollar = slots.every(
    (slot) => (amounts[slot.key] ?? 0) >= 1,
  );

  // Compares by value rather than key insertion order, since amounts read
  // back from the database won't necessarily list keys in the same order
  // they were written in.
  const amountsEqual = (
    a: Record<string, number>,
    b: Record<string, number>,
  ) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
    }
    return true;
  };
  const isDirty =
    !savedSnapshot ||
    !amountsEqual(amounts, savedSnapshot.amounts) ||
    overspendBehavior !== savedSnapshot.overspendBehavior;

  // No explicit "clear the selection" needed - editing any slot makes
  // amounts diverge from lastAppliedPresetAmounts, so this just goes null
  // on its own the next render.
  const activePreset =
    lastAppliedPreset &&
    lastAppliedPresetAmounts &&
    amountsEqual(amounts, lastAppliedPresetAmounts)
      ? lastAppliedPreset
      : null;

  const categoryTotals = CATEGORY_ORDER.map((category) => ({
    category,
    total: slots
      .filter((slot) => categoryForSlot(slot) === category)
      .reduce((sum, slot) => sum + (amounts[slot.key] ?? 0), 0),
  }));

  const applyPreset = (preset: BudgetPreset) => {
    const next = generatePresetAmounts(
      preset,
      settings.rosterSlots,
      effectiveSalaryCap,
    );
    setAmounts(next);
    setLastAppliedPreset(preset);
    if (mode === "live") {
      setTouchedKeys(new Set(Object.keys(next)));
    }
  };

  const setSlotAmount = (key: string, amount: number) => {
    setAmounts((current) => ({ ...current, [key]: amount }));
    if (mode === "live") {
      setTouchedKeys((current) => new Set(current).add(key));
    }
  };

  const revertSlot = (key: string) => {
    setAmounts((current) => ({
      ...current,
      [key]: predraftPlan?.amounts[key] ?? 0,
    }));
    setTouchedKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (mode === "predraft") {
        await upsertBudgetPlan({ seasonId, amounts, overspendBehavior });
      } else {
        const overrides = Object.fromEntries(
          [...touchedKeys].map((key) => [key, amounts[key] ?? 0]),
        );
        await upsertLiveBudgetOverrides({
          seasonId,
          overrides,
          overspendBehavior,
        });
      }
      setSavedSnapshot({ amounts: { ...amounts }, overspendBehavior });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save budget."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        "Revert the live budget to your original budget? Any in-draft reallocations will be lost.",
      )
    ) {
      return;
    }
    setIsResetting(true);
    setError(null);
    try {
      await resetLiveBudgetPlan({ seasonId });
      const resetAmounts = { ...(predraftPlan?.amounts ?? {}) };
      const resetOverspendBehavior =
        predraftPlan?.overspendBehavior ?? DEFAULT_OVERSPEND_BEHAVIOR;
      setAmounts(resetAmounts);
      setOverspendBehavior(resetOverspendBehavior);
      setTouchedKeys(new Set());
      // The reset mutation already cleared every live override server-side,
      // so this new state - mirroring pre-draft again - is already saved,
      // not pending. Same reasoning as the fresh-preset case above: don't
      // flag dirty for a state the server already has.
      setSavedSnapshot({
        amounts: resetAmounts,
        overspendBehavior: resetOverspendBehavior,
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to revert budget."));
    } finally {
      setIsResetting(false);
    }
  };

  // Docks under just AppHeader on the Setup app's pre-draft tab, or under
  // AppHeader + the Draft Room's MobileStatsRow (already fixed there for
  // every Draft Room tab - see DraftTopBar.tsx) on the live tab.
  const unallocatedBarTop =
    mode === "live"
      ? MOBILE_HEADER_HEIGHT + MOBILE_STATS_ROW_HEIGHT
      : MOBILE_HEADER_HEIGHT;

  return (
    <Stack gap="md" py="sm">
      <UnallocatedBar
        unallocated={unallocated}
        isDirty={isDirty}
        top={unallocatedBarTop}
      />
      {/* Reserves space for the fixed bar above, which is pulled out of
          document flow - mobile only, matching UnallocatedBar's own
          hiddenFrom="sm". */}
      <Box hiddenFrom="sm" h={BUDGET_UNALLOCATED_BAR_HEIGHT} />
      <Stack gap={2}>
        <Text fw={700} size="lg">
          {mode === "live" ? "Live Budget" : "Draft Budget"}
        </Text>
      </Stack>

      {/* Two columns from "md" up - side panel (presets/overspend/sanity
          checks) on the left, save controls + breakdown + slot list on the
          right, weighted 4/8 so the right side gets more room. Single
          stacked column below that where there isn't room. */}
      <Grid gutter="md" align="start">
        <Grid.Col span={{ base: 12, md: 4 }}>
          <BudgetSidePanel
            showPresets={mode === "predraft"}
            hasSuperflex={settings.rosterSlots.SUPERFLEX > 0}
            activePreset={activePreset}
            onApplyPreset={applyPreset}
            perStarter={perStarter}
            perBench={perBench}
            topThreePct={topThreePct}
            everySlotHasADollar={everySlotHasADollar}
            overspendBehavior={overspendBehavior}
            onOverspendChange={setOverspendBehavior}
          />
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            {error && (
              <Text c="red" size="sm">
                {error}
              </Text>
            )}
            {/* Stacked full-width below "sm", inline fit-content buttons above
              it - same responsive split used elsewhere (e.g.
              KeeperSearchForm.tsx). */}
            <Stack gap="xs" hiddenFrom="sm">
              <Button
                onClick={handleSave}
                loading={isSaving}
                disabled={!isDirty}
                fullWidth
              >
                Save Budget
              </Button>
              {mode === "live" && (
                <Button
                  variant="default"
                  color="orange"
                  onClick={handleReset}
                  loading={isResetting}
                  fullWidth
                >
                  Revert to original budget
                </Button>
              )}
              {/* Mobile's dirty-state badge lives in the fixed UnallocatedBar
                instead, both modes - see above. */}
            </Stack>
            <Group justify="space-between" visibleFrom="sm">
              <Group gap="xs">
                <Button
                  onClick={handleSave}
                  loading={isSaving}
                  disabled={!isDirty}
                  w="fit-content"
                >
                  Save Budget
                </Button>
                {mode === "live" && (
                  <Button
                    variant="default"
                    color="orange"
                    onClick={handleReset}
                    loading={isResetting}
                    w="fit-content"
                  >
                    Revert to original budget
                  </Button>
                )}
                <Badge
                  variant="light"
                  color={isDirty ? "yellow" : "teal"}
                  size="lg"
                >
                  {isDirty ? "Unsaved changes" : "All changes saved"}
                </Badge>
              </Group>
              {/* Mobile's copy lives in the fixed UnallocatedBar instead -
                  this row is already visibleFrom="sm". */}
              <Badge
                variant="light"
                color={unallocatedBadgeColor(unallocated)}
                size="lg"
              >
                {unallocatedBadgeLabel(unallocated)}
              </Badge>
            </Group>
            {usingGenericValues && <GenericValuesNotice />}

            <Card withBorder padding="md">
              <Stack gap="md">
                <CategoryBreakdown
                  categoryTotals={categoryTotals}
                  salaryCap={effectiveSalaryCap}
                />
                <Stack gap={6}>
                  {slots.map((slot) => (
                    <SlotRow
                      key={slot.key}
                      slot={slot}
                      amount={amounts[slot.key] ?? 0}
                      maxAmount={maxAmount}
                      onChange={(amount) => setSlotAmount(slot.key, amount)}
                      {...(filledSlotPlayers.has(slot.key)
                        ? { filledPlayer: filledSlotPlayers.get(slot.key)! }
                        : {})}
                      availablePlayers={availablePlayers}
                      eligiblePositions={eligiblePositionsForSlot(
                        slot,
                        settings.flexPositions,
                        settings.superflexPositions,
                      )}
                      onSelectPlayer={setSelectedFpid}
                      {...(mode === "live"
                        ? {
                            isOverridden: touchedKeys.has(slot.key),
                            onRevert: () => revertSlot(slot.key),
                          }
                        : {})}
                    />
                  ))}
                </Stack>
              </Stack>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={WEEK}
        scoringConfig={scoringConfigFromSeason(settings)}
        season={settings.year}
        seasonId={seasonId}
      />
    </Stack>
  );
}
