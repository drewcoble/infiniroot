import { Box, SimpleGrid, Stack } from "@mantine/core";
import { useMutation, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { WEEK } from "../../constants/general";
import { usePlanSlots } from "../../hooks/usePlanSlots";
import { useTeamBudget } from "../../hooks/useTeamBudget";
import {
  computeConsistencyThresholds,
  getConsistencyLabel,
  type ConsistencyLabel,
} from "../../lib/consistency";
import { matchPlanSlot } from "../../lib/planRecommendation";
import {
  filterRelevantPlayers,
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { buildStandardValueByFpid } from "../../lib/standardValues";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { assignSlotForPick } from "../../lib/slotAssignment";
import {
  POSITIONS,
  type PlayerTag,
  type Position,
  type ValueGap,
} from "../../types";
import { MobileNomination } from "./components/MobileNomination";
import { MobileStatsRow } from "./components/MobileStatsRow";
import { NominationPanel } from "./components/NominationPanel";
import { StatTile } from "./components/StatTile";
import { getErrorMessage } from "@shared/errors";

interface DraftTopBarProps {
  seasonId: Id<"seasons">;
  selfTeamId: Id<"seasonTeams">;
}

// Persistent across every Draft Room tab (mounted once by the layout route),
// so the whole auction - search, nominate, watch/bump the bid, log who won -
// can be run from any tab without ever switching to a dedicated "Draft" tab.
export function DraftTopBar({ seasonId, selfTeamId }: DraftTopBarProps) {
  const [search, setSearch] = useState("");
  const [winnerTeamId, setWinnerTeamId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);

  const settingsList = useQuery(api.leagues.listSeasons, {});
  const teams = useQuery(api.infinidraft.draft.teams.listSeasonTeams, { seasonId });
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  const activeNomination = useQuery(api.infinidraft.draft.picks.getActiveNomination, {
    seasonId,
  });

  const settings = settingsList?.find((s) => s._id === seasonId);
  const thisSeason = settings?.year ?? String(new Date().getFullYear());

  const nominationConfig = useQuery(
    api.infinidraft.draft.nominationOrder.getNominationConfig,
    { seasonId },
  );
  const currentNominator = useQuery(
    api.infinidraft.draft.nominationOrder.getCurrentNominator,
    nominationConfig?.nominationOrder ? { seasonId } : "skip",
  );
  const planSlots = usePlanSlots(seasonId, selfTeamId);
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const allRankings = useQuery(api.rankings.getAllRankings, { week: WEEK });
  const standardValues = useQuery(api.standardValues.getStandardValues, {
    season: thisSeason,
  });
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

  // Target/avoid tag, value-gap (breakout/undervalued/overvalued/falloff),
  // and consistency (Reliable/Boom-Bust/Low Output) badges - same bulk-
  // query-then-map pattern PlayersLeftTab.tsx uses, surfaced here only for
  // MobileNomination's search results/active-nomination rows (desktop's
  // NominationPanel card has no room for them and never reads these maps).
  const playerTags = useQuery(api.infinidraft.draft.tags.listPlayerTags, { seasonId });
  const valueGaps = useQuery(
    api.valueGaps.getAllValueGaps,
    settings
      ? {
          week: WEEK,
          scoringConfig: scoringConfigFromSeason(settings),
          lastSeason: String(Number(thisSeason) - 1),
        }
      : "skip",
  );
  const seasonStats = useQuery(
    api.playerPoints.getAllSeasonStats,
    settings
      ? {
          season: String(Number(thisSeason) - 1),
          scoringConfig: scoringConfigFromSeason(settings),
        }
      : "skip",
  );

  const nominate = useMutation(api.infinidraft.draft.picks.nominate);
  const addCustomPlayer = useMutation(api.infinidraft.draft.customPlayers.addCustomPlayer);
  const bumpNominationBid = useMutation(api.infinidraft.draft.picks.bumpNominationBid);
  const setNominationBid = useMutation(api.infinidraft.draft.picks.setNominationBid);
  const resolvePick = useMutation(api.infinidraft.draft.picks.resolvePick);
  const passNomination = useMutation(api.infinidraft.draft.picks.passNomination);
  const undoNomination = useMutation(api.infinidraft.draft.picks.undoNomination);
  const setCurrentNominator = useMutation(
    api.infinidraft.draft.nominationOrder.setCurrentNominator,
  );
  const cyclePlayerTag = useMutation(api.infinidraft.draft.tags.cyclePlayerTag);

  // Who gets credited on the nomination that's about to be made - mirrors
  // the turn selector's current turn exactly, including the "no one"
  // (manual) state - no fallback team, since defaulting silently to someone
  // would misattribute the nomination. When no order is configured,
  // self-nominate is the only option.
  const nominatingTeamId = nominationConfig?.nominationOrder
    ? (currentNominator?.currentTeamId ?? undefined)
    : selfTeamId;

  const nameByFpid = useMemo(() => {
    const map = new Map<number, { name: string; team: string | null }>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, row);
    }
    return map;
  }, [allProjections]);

  const draftValueByFpid = useMemo(() => {
    const map = new Map<number, { dollarValue: number }>();
    for (const value of draftValues ?? []) {
      map.set(value.fpid, value);
    }
    return map;
  }, [draftValues]);

  const standardValueByFpid = useMemo(
    () =>
      buildStandardValueByFpid(
        standardValues,
        settings?.scoring ?? "PPR",
        (settings?.rosterSlots.SUPERFLEX ?? 0) > 0,
      ),
    [standardValues, settings],
  );

  const adpByFpid = useMemo(() => {
    const map = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const ranking of allRankings ?? []) {
      map.set(ranking.fpid, ranking);
    }
    return map;
  }, [allRankings]);

  const draftedFpids = useMemo(
    () => new Set((picks ?? []).map((pick) => pick.fpid)),
    [picks],
  );

  // Nominating-team pickers (the desktop turn Select, the mobile team chip
  // row) should read in the order teams actually nominate in, not whichever
  // order `listSeasonTeams` happens to return - same reasoning/pattern as
  // DraftBoard.tsx's teamSummaries sort. Falls back to the raw team list
  // when no nomination order is configured yet.
  const orderedTeams = useMemo(() => {
    const orderIndex = new Map(
      (nominationConfig?.nominationOrder ?? []).map((teamId, index) => [
        teamId,
        index,
      ]),
    );
    if (orderIndex.size === 0) return teams ?? [];
    return [...(teams ?? [])].sort(
      (a, b) =>
        (orderIndex.get(a._id) ?? Infinity) -
        (orderIndex.get(b._id) ?? Infinity),
    );
  }, [teams, nominationConfig]);

  const tagByFpid = useMemo(() => {
    const map = new Map<number, PlayerTag>();
    for (const row of playerTags ?? []) map.set(row.fpid, row.tag);
    return map;
  }, [playerTags]);

  const valueGapByFpid = useMemo(() => {
    const map = new Map<number, ValueGap>();
    for (const gap of valueGaps ?? []) map.set(gap.fpid, gap);
    return map;
  }, [valueGaps]);

  // Same per-position threshold computation as PlayersLeftTab.tsx.
  const consistencyByFpid = useMemo(() => {
    const map = new Map<number, ConsistencyLabel>();
    if (!seasonStats) return map;
    const byPosition = new Map<Position, typeof seasonStats>();
    for (const row of seasonStats) {
      const list = byPosition.get(row.position) ?? [];
      list.push(row);
      byPosition.set(row.position, list);
    }
    for (const [position, rows] of byPosition) {
      const thresholds = computeConsistencyThresholds(position, rows);
      for (const row of rows) {
        const label = getConsistencyLabel(position, row, thresholds);
        if (label) map.set(row.fpid, label);
      }
    }
    return map;
  }, [seasonStats]);

  const activePositions = useMemo(() => {
    if (!settings) return [];
    return POSITIONS.filter(
      (pos) =>
        settings.rosterSlots[pos] > 0 ||
        settings.flexPositions.includes(pos) ||
        settings.superflexPositions.includes(pos),
    );
  }, [settings]);

  const searchResults = useMemo(() => {
    if (!allProjections || !settings || search.trim().length < 2) return [];
    const relevant = filterRelevantPlayers(
      allProjections,
      activePositions,
      settings.scoring,
      adpByFpid,
      (row) => pointsForScoringConfig(row, scoringConfigFromSeason(settings)),
    );
    const query = search.trim().toLowerCase();
    return relevant
      .filter(
        (row) =>
          !draftedFpids.has(row.fpid) && row.name.toLowerCase().includes(query),
      )
      .sort(
        (a, b) =>
          (draftValueByFpid.get(b.fpid)?.dollarValue ?? 0) -
          (draftValueByFpid.get(a.fpid)?.dollarValue ?? 0),
      )
      .slice(0, 8)
      .map((row) => {
        const tag = tagByFpid.get(row.fpid);
        const valueGap = valueGapByFpid.get(row.fpid);
        const consistency = consistencyByFpid.get(row.fpid);
        return {
          ...row,
          ...(tag ? { tag } : {}),
          ...(valueGap ? { valueGap } : {}),
          ...(consistency ? { consistency } : {}),
          onCycleTag: () => {
            cyclePlayerTag({ seasonId, fpid: row.fpid }).catch((err) => {
              setActionError(getErrorMessage(err, "Failed to update tag."));
            });
          },
        };
      });
  }, [
    allProjections,
    settings,
    search,
    activePositions,
    adpByFpid,
    draftedFpids,
    draftValueByFpid,
    tagByFpid,
    valueGapByFpid,
    consistencyByFpid,
    cyclePlayerTag,
    seasonId,
  ]);

  const nominatedValue = activeNomination
    ? draftValueByFpid.get(activeNomination.fpid)
    : undefined;

  const nominatedStandardValue = activeNomination
    ? standardValueByFpid.get(activeNomination.fpid)
    : undefined;

  const nominatedPlayer = activeNomination
    ? nameByFpid.get(activeNomination.fpid)
    : undefined;

  const stats = useTeamBudget(
    seasonId,
    selfTeamId,
    activeNomination?.position,
    nominatedValue?.dollarValue,
  );

  // Which of the team's still-open budget-plan slots the current nomination's
  // market value best matches - the same value-based matching PlayersLeftTab
  // uses, so "Plan-safe max" and this figure never disagree.
  const planMatch = useMemo(() => {
    if (!activeNomination || !planSlots) return undefined;
    return matchPlanSlot(
      activeNomination.position,
      nominatedValue?.dollarValue ?? 0,
      planSlots.openSlots,
      planSlots.amounts,
      planSlots.flexPositions,
      planSlots.superflexPositions,
    );
  }, [activeNomination, planSlots, nominatedValue]);

  const selfFilledSlotKeys = useMemo(
    () =>
      new Set(
        (picks ?? [])
          .filter((pick) => pick.teamId === selfTeamId)
          .map((pick) => pick.planSlotKey)
          .filter((key): key is string => !!key),
      ),
    [picks, selfTeamId],
  );

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(getErrorMessage(err, "That action failed."));
    }
  };

  // Escape hatch for search coming up empty - a real player the app has no
  // data for yet (too new a signing/trade, or outside the relevant-players
  // cutoff). Mints the player via addCustomPlayer, then nominates it exactly
  // like any search result - see convex/draft/customPlayers.ts.
  const onAddCustomPlayer = (name: string, position: Position) => {
    runAction(async () => {
      const fpid = await addCustomPlayer({
        seasonId,
        name,
        position,
        week: WEEK,
      });
      await nominate({
        seasonId,
        fpid,
        ...(nominatingTeamId ? { nominatingTeamId } : {}),
        openingBid: 1,
      });
    });
    setSearch("");
  };

  if (!settings || !teams || !picks || !stats) return null;

  const totalPicks =
    expandRosterSlots(settings.rosterSlots).length * teams.length;
  const nextPickNumber = Math.min(picks.length + 1, totalPicks);

  // Mobile-only unification of onLogWin/onLogWinner below - the desktop
  // panel keeps its dedicated "I won" button (self team, with plan-slot
  // tracking) separate from "someone else won" (no plan-slot tracking,
  // since that's only relevant for the self team's own budget plan). The
  // mobile bar drops the separate "I won" button in favor of always
  // picking a team (self listed first) from one list, so this just
  // branches on whether that pick was the self team.
  const assignWinner = (teamId: Id<"seasonTeams">) => {
    if (!activeNomination) return;
    runAction(() => {
      if (teamId === selfTeamId) {
        const planSlotKey = assignSlotForPick(
          activeNomination.position,
          settings.rosterSlots,
          selfFilledSlotKeys,
          settings.flexPositions,
          settings.superflexPositions,
        );
        return resolvePick({
          seasonId,
          fpid: activeNomination.fpid,
          teamId,
          price: activeNomination.currentBid,
          ...(planSlotKey ? { planSlotKey } : {}),
        });
      }
      return resolvePick({
        seasonId,
        fpid: activeNomination.fpid,
        teamId,
        price: activeNomination.currentBid,
      });
    });
  };

  return (
    <>
      {/* Persistent sidebar (route.tsx docks this beside the tab content,
          not above it) - sticky so the nominate/bid card and budget stats
          stay visible while scrolling a long Players/League table. Fixed
          340px width to match the Draft Bar Sidebar Redesign mockup
          ("Infinidraft UX review" Claude Design project). maxHeight +
          overflowY so a tall sidebar (e.g. many stat tiles) scrolls
          internally instead of pushing past the viewport. */}
      <Box
        visibleFrom="sm"
        style={{
          width: 340,
          flexShrink: 0,
          position: "sticky",
          top: 16,
          maxHeight: "calc(100vh - 32px)",
          overflowY: "auto",
        }}
      >
        <Stack gap="sm">
          <NominationPanel
            nextPickNumber={nextPickNumber}
            totalPicks={totalPicks}
            teams={orderedTeams}
            nominationOrderEnabled={!!nominationConfig?.nominationOrder}
            turnTeamId={currentNominator?.currentTeamId}
            onSetTurnTeam={(teamId) =>
              runAction(() => setCurrentNominator({ seasonId, teamId }))
            }
            activeNomination={activeNomination ?? undefined}
            nominatedPlayer={nominatedPlayer}
            nominatedValue={nominatedValue}
            nominatedStandardValue={nominatedStandardValue}
            planMatch={planMatch}
            winnerTeamId={winnerTeamId}
            onWinnerTeamIdChange={setWinnerTeamId}
            onBumpBid={(delta) =>
              runAction(() => bumpNominationBid({ seasonId, delta }))
            }
            onSetBid={(amount) =>
              runAction(() => setNominationBid({ seasonId, amount }))
            }
            onLogWin={() => assignWinner(selfTeamId)}
            onLogWinner={() =>
              runAction(async () => {
                if (!activeNomination || !winnerTeamId) return;
                await resolvePick({
                  seasonId,
                  fpid: activeNomination.fpid,
                  teamId: winnerTeamId as Id<"seasonTeams">,
                  price: activeNomination.currentBid,
                });
                setWinnerTeamId(null);
              })
            }
            onPass={() => runAction(() => passNomination({ seasonId }))}
            search={search}
            onSearchChange={setSearch}
            searchResults={searchResults}
            activePositions={activePositions}
            draftValueByFpid={draftValueByFpid}
            onNominate={(fpid) => {
              runAction(() =>
                nominate({
                  seasonId,
                  fpid,
                  ...(nominatingTeamId ? { nominatingTeamId } : {}),
                  openingBid: 1,
                }),
              );
              setSearch("");
            }}
            onAddCustomPlayer={onAddCustomPlayer}
            usingGenericValues={usingGenericValues}
            actionError={actionError}
            onSelectPlayer={setSelectedFpid}
          />
          <SimpleGrid cols={1} spacing="sm">
            <StatTile label="Remaining" value={`$${stats.remaining}`} />
            <StatTile
              label="Max Bid"
              value={`$${Math.max(stats.maxBid, 0)}`}
            />
            {stats.planSafe !== null && (
              <StatTile
                label="Budget +/-"
                value={
                  stats.planSafe > 0
                    ? `+$${stats.planSafe}`
                    : `-$${Math.abs(stats.planSafe)}`
                }
                valueColor={
                  stats.planSafe > 0
                    ? "green"
                    : stats.planSafe < 0
                      ? "red"
                      : "inherit"
                }
              />
            )}
            <StatTile label="Empty Spots" value={stats.openSlots.toString()} />
            <StatTile
              label="Per Open Slot"
              value={`$${stats.perOpenSlot.toFixed(1)}`}
            />
          </SimpleGrid>
        </Stack>
      </Box>

      <MobileNomination
        nominationOrderEnabled={!!nominationConfig?.nominationOrder}
        turnTeamId={currentNominator?.currentTeamId}
        onSetTurnTeam={(teamId) =>
          runAction(() => setCurrentNominator({ seasonId, teamId }))
        }
        teams={orderedTeams}
        selfTeamId={selfTeamId}
        activeNomination={activeNomination ?? undefined}
        nominatedPlayer={nominatedPlayer}
        nominatedValue={nominatedValue}
        nominatedStandardValue={nominatedStandardValue}
        planMatch={planMatch}
        activeTag={
          activeNomination ? tagByFpid.get(activeNomination.fpid) : undefined
        }
        activeValueGap={
          activeNomination
            ? valueGapByFpid.get(activeNomination.fpid)
            : undefined
        }
        activeConsistency={
          activeNomination
            ? consistencyByFpid.get(activeNomination.fpid)
            : undefined
        }
        onCycleTag={(fpid) => {
          cyclePlayerTag({ seasonId, fpid }).catch((err) => {
            setActionError(getErrorMessage(err, "Failed to update tag."));
          });
        }}
        onBumpBid={(delta) =>
          runAction(() => bumpNominationBid({ seasonId, delta }))
        }
        onSetBid={(amount) =>
          runAction(() => setNominationBid({ seasonId, amount }))
        }
        onAssignWinner={assignWinner}
        onUndo={() => runAction(() => undoNomination({ seasonId }))}
        search={search}
        onSearchChange={setSearch}
        searchResults={searchResults}
        activePositions={activePositions}
        draftValueByFpid={draftValueByFpid}
        onNominate={(fpid) => {
          runAction(() =>
            nominate({
              seasonId,
              fpid,
              ...(nominatingTeamId ? { nominatingTeamId } : {}),
              openingBid: 1,
            }),
          );
          setSearch("");
        }}
        onAddCustomPlayer={onAddCustomPlayer}
        usingGenericValues={usingGenericValues}
        onSelectPlayer={setSelectedFpid}
      />

      <MobileStatsRow
        maxBid={stats.maxBid}
        planSafe={stats.planSafe}
        openSlots={stats.openSlots}
        perOpenSlot={stats.perOpenSlot}
      />

      <PlayerDetailModal
        fpid={selectedFpid}
        onClose={() => setSelectedFpid(null)}
        week={WEEK}
        scoringConfig={scoringConfigFromSeason(settings)}
        season={thisSeason}
        seasonId={seasonId}
      />
    </>
  );
}
