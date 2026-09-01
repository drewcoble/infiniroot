import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Card, Group, Progress, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { optimalAssignPicksToSlots } from "../../lib/slotAssignment";
import { useTeamBudget } from "../../hooks/useTeamBudget";
import { positionColorOrDefault } from "@shared/positionColors";
import { WEEK } from "../../constants/general";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import {
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { SlotTable } from "./components/SlotTable";
import { getErrorMessage } from "@shared/errors";

interface MyTeamTabProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
  selfTeamId: Id<"seasonTeams">;
}

export function MyTeamTab({ seasonId, selfTeamId }: MyTeamTabProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  const plan = useQuery(api.infinidraft.draft.plan.getLiveBudgetPlan, { seasonId });
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const settings = settingsList?.find((s) => s._id === seasonId);
  // AUCTION.md/SNAKE.md's standard frontend pattern - gates the $-budget
  // stat, SlotTable's Budget column, and the "Where the money went" card
  // below, none of which have a snake/linear equivalent (SNAKE_DRAFT.md
  // §3.4). Previously unguarded (SNAKE.md's documented "budget-stat
  // leakage" gap) - a snake/linear team's page showed "$0 of $200 spent"
  // and a wall of "plan $0" rows for every slot (user report, 2026-08-30).
  const isAuction = (settings?.draftType ?? "auction") === "auction";
  const stats = useTeamBudget(seasonId, selfTeamId);
  const removePick = useMutation(api.infinidraft.draft.picks.removePick);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);

  const handleRemove = async (pickId: Id<"draftPicks">) => {
    setRemoveError(null);
    try {
      await removePick({ pickId });
    } catch (err) {
      setRemoveError(getErrorMessage(err, "Failed to remove pick."));
    }
  };

  const nameByFpid = useMemo(() => {
    const map = new Map<number, { name: string; team: string | null }>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, row);
    }
    return map;
  }, [allProjections]);

  const myPicks = useMemo(
    () => (picks ?? []).filter((pick) => pick.teamId === selfTeamId),
    [picks, selfTeamId],
  );

  // Sourced from raw projections (every player, keeper or not), NOT the $
  // value engine's `values` - that pool deliberately excludes keepers
  // (they're off the auction board before it even starts), which silently
  // fell back to 0 points for every keeper here and pushed them all to the
  // bottom of the bench regardless of their real projection (user report,
  // 2026-08-30). Numerically identical to the $ engine's own points for
  // anyone who IS in that pool - same pointsForScoringConfig computation
  // over the same projections rows, just not gated on "was this player
  // ever auctionable."
  const pointsByFpid = useMemo(() => {
    const map = new Map<number, number>();
    if (!settings) return map;
    const scoringConfig = scoringConfigFromSeason(settings);
    for (const row of allProjections ?? []) {
      map.set(row.fpid, pointsForScoringConfig(row, scoringConfig));
    }
    return map;
  }, [allProjections, settings]);

  const slots = useMemo(
    () => (settings ? expandRosterSlots(settings.rosterSlots) : []),
    [settings],
  );

  // Always the current points-optimal placement, not a stored/manual one -
  // see optimalAssignPicksToSlots's comment. Recomputes from scratch on
  // every pick add/remove so the highest scorers at each position are
  // always the ones starting, with leftovers pooled into FLEX/SUPERFLEX by
  // points.
  const pickBySlotKey = useMemo(
    () =>
      settings
        ? optimalAssignPicksToSlots(
            myPicks,
            settings.rosterSlots,
            settings.flexPositions,
            settings.superflexPositions,
            pointsByFpid,
          )
        : new Map<string, (typeof myPicks)[number]>(),
    [myPicks, settings, pointsByFpid],
  );

  // Group plan vs actual by position (FLEX/SFLEX/BN slots - which have no
  // single fixed position - get their own bucket using the slot label).
  const spendByGroup = useMemo(() => {
    const groups = new Map<string, { plan: number; actual: number }>();
    for (const slot of slots) {
      const key = slot.position ?? slot.label.replace(/\d+$/, "");
      const entry = groups.get(key) ?? { plan: 0, actual: 0 };
      entry.plan += plan?.amounts[slot.key] ?? 0;
      const pick = pickBySlotKey.get(slot.key);
      // Budget planning is auction-only (SNAKE_DRAFT.md §3.4).
      if (pick) entry.actual += pick.price ?? 0;
      groups.set(key, entry);
    }
    return Array.from(groups.entries());
  }, [slots, plan, pickBySlotKey]);

  const benchSlots = slots.filter((slot) => slot.label.startsWith("BN"));
  const benchFilled = benchSlots.filter((slot) =>
    pickBySlotKey.has(slot.key),
  ).length;

  const thisSeason = settings?.year ?? String(new Date().getFullYear());

  return (
    <Stack gap="md" py="sm">
      <Card withBorder padding="md">
        <Stack gap="sm">
          {stats && (
            <Group gap="lg">
              {isAuction && (
                <Text size="sm" c="dimmed">
                  ${stats.spent} of ${stats.spent + stats.remaining} spent
                </Text>
              )}
              <Text size="sm" c="dimmed">
                {stats.totalSlots - stats.openSlots} of {stats.totalSlots} slots
                filled
              </Text>
            </Group>
          )}

          {removeError && (
            <Text c="red" size="sm">
              {removeError}
            </Text>
          )}

          <SlotTable
            slots={slots}
            pickBySlotKey={pickBySlotKey}
            planAmounts={plan?.amounts ?? {}}
            nameByFpid={nameByFpid}
            onRemove={handleRemove}
            onSelectPlayer={setSelectedFpid}
            trackConsecutiveYears={
              settings?.keeperRules?.maxConsecutiveYears !== undefined
            }
            isAuction={isAuction}
          />
        </Stack>
      </Card>

      {isAuction && (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              Where the money went
            </Text>
            {spendByGroup.map(([group, { plan: planTotal, actual }]) => (
              <Group key={group} gap="sm" wrap="nowrap">
                <Text size="sm" w={60}>
                  {group}
                </Text>
                <Progress
                  value={
                    planTotal > 0
                      ? Math.min((actual / planTotal) * 100, 100)
                      : 0
                  }
                  color={positionColorOrDefault(group)}
                  flex={1}
                />
                <Text size="sm" c="dimmed" w={90} ta="right">
                  ${actual} / ${planTotal}
                </Text>
              </Group>
            ))}
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text size="sm" fw={500}>
            Bench - {benchFilled} of {benchSlots.length} filled
          </Text>
          <Progress
            value={
              benchSlots.length ? (benchFilled / benchSlots.length) * 100 : 0
            }
          />
        </Stack>
      </Card>

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={WEEK}
        scoringConfig={
          settings
            ? scoringConfigFromSeason(settings)
            : { scoring: "PPR", teScoring: "NONE", sixPointPassTds: false }
        }
        season={thisSeason}
        seasonId={seasonId}
      />
    </Stack>
  );
}
