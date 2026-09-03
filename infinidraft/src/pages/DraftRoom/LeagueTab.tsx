import {
  ActionIcon,
  Badge,
  Card,
  Divider,
  Group,
  Progress,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { TeamSlotDetail } from "../../components/TeamSlotDetail";
import {
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { WEEK } from "../../constants/general";
import {
  POSITION_ORDER,
  positionColorOrDefault,
} from "@shared/positionColors";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { getErrorMessage } from "@shared/errors";
import { optimalAssignPicksToSlots } from "../../lib/slotAssignment";
import {
  computeMaxPerStarter,
  computeTeamBudgetStats,
  resolveTeamSalaryCap,
} from "../../lib/teamBudget";

interface LeagueTabProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
  selfTeamId: Id<"seasonTeams">;
}

// QB and SFLEX share one needs-badge column instead of each getting their
// own - a superflex slot is almost always spent on a QB in practice, so
// the two read as one combined "quarterback-ish" need at a glance rather
// than two separate ones.
const QB_SFLEX_COMBO: Record<string, string> = { QB: "SFLEX" };

export function LeagueTab({ seasonId, teams, selfTeamId }: LeagueTabProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === seasonId);
  // AUCTION.md/SNAKE.md's standard frontend pattern - gates the "can match
  // your $X"/"max bid"/"max $/starter" $ stats and the $-based fill bar
  // below, none of which have a snake/linear equivalent (SNAKE_DRAFT.md
  // §3.4). Previously unguarded (SNAKE.md's documented "budget-stat
  // leakage" gap, alongside MyTeamTab.tsx - see that fix) - a snake/linear
  // league's League tab showed a "max bid: $200"-style figure computed off
  // spent=$0 for every team (always meaningless, since price is never set),
  // and a per-team progress bar driven by $ remaining/spent instead of
  // actual roster fill (user report, 2026-08-30).
  const isAuction = (settings?.draftType ?? "auction") === "auction";
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const [expandedTeamIds, setExpandedTeamIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const removePick = useMutation(api.infinidraft.draft.picks.removePick);
  const [removeError, setRemoveError] = useState<string | null>(null);

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
    for (const row of allProjections ?? []) map.set(row.fpid, row);
    return map;
  }, [allProjections]);

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

  const teamSummaries = useMemo(() => {
    if (!settings || !picks) return [];
    return teams.map((team) => {
      const teamPicks = picks
        .filter((pick) => pick.teamId === team._id)
        .sort((a, b) => a.sequence - b.sequence);
      // Budget stats are auction-only (SNAKE_DRAFT.md §3.4).
      const spent = teamPicks.reduce((sum, pick) => sum + (pick.price ?? 0), 0);
      const stats = computeTeamBudgetStats(
        resolveTeamSalaryCap(team, settings.salaryCap),
        settings.rosterSlots,
        teamPicks.length,
        spent,
      );
      const slots = expandRosterSlots(settings.rosterSlots);
      // Always the current points-optimal placement (see MyTeamTab's
      // pickBySlotKey comment) - applies to every team, not just self, so
      // the host sees each opponent's true best lineup too.
      const bySlot = optimalAssignPicksToSlots(
        teamPicks,
        settings.rosterSlots,
        settings.flexPositions,
        settings.superflexPositions,
        pointsByFpid,
      );
      const openSlots = slots.filter((slot) => !bySlot.has(slot.key));
      // How many still-open slots this team has in each group - same
      // label-stripping as allNeedGroups/groupSlotCounts below (see their
      // comments) so a group here matches the fixed set of badge slots
      // every team's card reserves. Counts (not just presence) drive the
      // stacked-badges-per-slot needs row - see the render below.
      const openCountByGroup = new Map<string, number>();
      for (const slot of openSlots) {
        const group = slot.label.replace(/\d+$/, "");
        openCountByGroup.set(group, (openCountByGroup.get(group) ?? 0) + 1);
      }
      // Auction: % of budget remaining (a "financial health" bar, not a
      // literal roster-fill one - a team that's spent little still reads as
      // "full" here). Snake/linear has no $ concept at all, so this instead
      // falls back to actual roster fill (picks made / total slots), which
      // is also what the caption directly below the bar already says.
      const fillPct = isAuction
        ? (stats.remaining / (stats.remaining + stats.spent)) * 100
        : (teamPicks.length / stats.totalSlots) * 100;
      const maxPerStarter = computeMaxPerStarter(stats.remaining, openSlots);
      return {
        team,
        teamPicks,
        stats,
        slots,
        bySlot,
        openCountByGroup,
        fillPct,
        maxPerStarter,
      };
    });
  }, [teams, settings, picks, pointsByFpid, isAuction]);

  // The full, fixed set of position groups a "needs" row could ever show for
  // this league (same roster shape for every team), and how many slots each
  // one has league-wide (e.g. 2 for a 2-RB league) - every team's card
  // always reserves that many badge slots per group (openCountByGroup
  // above decides how many render visible vs. hidden placeholders), so a
  // group's badges sit in the same horizontal spot whether or not this
  // team still needs all of them, making it easy to scan across teams at a
  // glance. Same label-stripping/sort as the old inline computation below,
  // just against every roster slot instead of only the still-open ones.
  const { allNeedGroups, groupSlotCounts } = useMemo((): {
    allNeedGroups: string[];
    groupSlotCounts: Map<string, number>;
  } => {
    if (!settings) return { allNeedGroups: [], groupSlotCounts: new Map() };
    const slots = expandRosterSlots(settings.rosterSlots);
    const counts = new Map<string, number>();
    for (const slot of slots) {
      const group = slot.label.replace(/\d+$/, "");
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    const groups = Array.from(counts.keys())
      .filter((group) => POSITION_ORDER.includes(group))
      .sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
    return { allNeedGroups: groups, groupSlotCounts: counts };
  }, [settings]);

  // Groups the columns above into needs-badge columns, combining QB/SFLEX
  // per QB_SFLEX_COMBO - every other group still gets its own column.
  const needColumns = useMemo(() => {
    const columns: { key: string; groups: string[] }[] = [];
    const consumed = new Set<string>();
    for (const group of allNeedGroups) {
      if (consumed.has(group)) continue;
      const partner = QB_SFLEX_COMBO[group];
      if (partner && allNeedGroups.includes(partner)) {
        columns.push({ key: `${group}-${partner}`, groups: [group, partner] });
        consumed.add(partner);
      } else {
        columns.push({ key: group, groups: [group] });
      }
    }
    return columns;
  }, [allNeedGroups]);

  const sortedSummaries = useMemo(() => {
    const self = teamSummaries.filter((ts) => ts.team.isSelf);
    const others = teamSummaries
      .filter((ts) => !ts.team.isSelf)
      .sort((a, b) => b.stats.remaining - a.stats.remaining);
    return [...self, ...others];
  }, [teamSummaries]);

  const selfSummary = teamSummaries.find((s) => s.team._id === selfTeamId);
  const teamsCanMatch = selfSummary
    ? teamSummaries.filter(
        (s) =>
          s.team._id !== selfTeamId &&
          s.stats.maxBid >= selfSummary.stats.maxBid,
      ).length
    : 0;

  const toggleExpanded = (teamId: string) => {
    setExpandedTeamIds((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  if (!settings || !picks) return null;

  const thisSeason = settings.year;

  return (
    <Stack gap="md" py="sm">
      {isAuction && selfSummary && (
        <Text size="sm" c="dimmed">
          {teamsCanMatch} team{teamsCanMatch === 1 ? "" : "s"} can match your $
          {Math.max(selfSummary.stats.maxBid, 0)}
        </Text>
      )}
      {removeError && (
        <Text c="red" size="sm">
          {removeError}
        </Text>
      )}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {sortedSummaries.map(
          ({
            team,
            stats,
            openCountByGroup,
            fillPct,
            teamPicks,
            slots,
            bySlot,
            maxPerStarter,
          }) => (
            <Card
              key={team._id}
              withBorder
              padding="md"
              onClick={() => toggleExpanded(team._id)}
              style={{ cursor: "pointer" }}
            >
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Group gap={4} wrap="nowrap">
                    <Text fw={700}>
                      {team.name}
                      {team.isSelf ? " (you)" : ""}
                    </Text>
                    {/* Decorative only - the whole card is the click target
                        (see the Card's own onClick above), this just makes
                        it visually obvious the card expands. */}
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={
                        expandedTeamIds.has(team._id)
                          ? "Hide roster"
                          : "Show roster"
                      }
                    >
                      {expandedTeamIds.has(team._id) ? (
                        <ChevronUp size={16} />
                      ) : (
                        <ChevronDown size={16} />
                      )}
                    </ActionIcon>
                  </Group>
                  {isAuction && (
                    <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                      max bid: <strong>${Math.max(stats.maxBid, 0)}</strong>
                    </Text>
                  )}
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">
                    {isAuction && (
                      <>
                        {/* Most aggressive per-starter estimate - reserves
                            just $1 for bench/K/DST (a common punt strategy)
                            instead of splitting evenly across every open
                            slot the way maxBid above does. See
                            computeMaxPerStarter. */}
                        {maxPerStarter !== null
                          ? `max $${Math.max(Math.round(maxPerStarter), 0)}/starter`
                          : "no starter slots open"}
                        {" - "}
                      </>
                    )}
                    {teamPicks.length}/{stats.totalSlots} filled
                  </Text>
                </Group>
                <Progress value={fillPct} size="lg" color="green" />
                <Text size="xs" c="dimmed" mt={4}>
                  Needs
                </Text>
                <Group
                  justify="space-between"
                  wrap="wrap"
                  gap="xs"
                  align="flex-start"
                >
                  {/* Every column renders in the same order, with the same
                      number of badges per group (groupSlotCounts - the
                      league-wide total for that group), for every team - so
                      a column's badges always sit in the same spot whether
                      or not this team still needs all of them. One badge
                      per still-open slot in that group (openCountByGroup),
                      stacked vertically (QB/SFLEX sharing a column - see
                      needColumns); the rest render invisible (same label,
                      so same height) rather than disappearing, both so the
                      row doesn't reflow as picks come in and so drafting
                      e.g. a WR removes just the last WR badge instead of
                      the whole group vanishing. */}
                  {needColumns.map(({ key, groups }) => (
                    <Stack key={key} gap={2}>
                      {groups.map((group) => {
                        const openCount = openCountByGroup.get(group) ?? 0;
                        const slotCount = groupSlotCounts.get(group) ?? 0;
                        return Array.from({ length: slotCount }, (_, i) => (
                          <Badge
                            key={`${group}-${i}`}
                            color={positionColorOrDefault(group)}
                            size="xs"
                            variant="light"
                            style={
                              i < openCount
                                ? undefined
                                : { visibility: "hidden" }
                            }
                          >
                            {group}
                          </Badge>
                        ));
                      })}
                    </Stack>
                  ))}
                </Group>
                {expandedTeamIds.has(team._id) && (
                  <>
                    {/* A little more breathing room than hugging the needs
                        badges directly above, without going all the way
                        to the Card's own padding="md" (16px, too much). */}
                    <Divider mt="xs" />
                    <TeamSlotDetail
                      slots={slots}
                      bySlot={bySlot}
                      nameByFpid={nameByFpid}
                      onRemove={handleRemove}
                      onSelectPlayer={setSelectedFpid}
                      trackConsecutiveYears={
                        settings.keeperRules?.maxConsecutiveYears !== undefined
                      }
                    />
                  </>
                )}
              </Stack>
            </Card>
          ),
        )}
      </SimpleGrid>

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={WEEK}
        scoringConfig={scoringConfigFromSeason(settings)}
        season={thisSeason}
        seasonId={seasonId}
      />
    </Stack>
  );
}
