import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Center, Divider, Grid, Loader, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { POSITIONS, type Position } from "../../types";
import {
  filterRelevantPlayers,
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import { assignSlotForPick } from "../../lib/slotAssignment";
import { WEEK } from "../../constants/general";
import { PlayerDetailModal } from "../../components/PlayerDetailModal";
import { GenericValuesNotice } from "../../components/GenericValuesNotice";
import { KeeperCardList } from "./components/KeeperCardList";
import { KeeperEditModal } from "./components/KeeperEditModal";
import { KeeperSearchForm } from "./components/KeeperSearchForm";
import { KeeperRulesPanel } from "./components/KeeperRulesPanel";
import { RecommendedKeepers } from "./components/RecommendedKeepers";
import { SleeperKeeperSuggestions } from "./components/SleeperKeeperSuggestions";
import { keeperPairKey } from "../../lib/keeperCost";
import { ManualPreviousSeasonModal } from "./components/ManualPreviousSeasonModal";
import { getErrorMessage } from "@shared/errors";
import { useRookieFpids } from "../../hooks/useRookieFpids";

interface KeepersTabProps {
  seasonId: Id<"seasons">;
}

export function KeepersTab({ seasonId }: KeepersTabProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((league) => league._id === seasonId);
  // A snake/linear league's keeper cost is a draft-slot round, not a dollar
  // price (SNAKE_DRAFT.md §8) - same "derive from draftType" convention as
  // LeagueDetails.tsx's isSnakeOrLinear and KeeperRulesPanel's copy of it.
  const isSnakeOrLinear = (settings?.draftType ?? "auction") !== "auction";
  const draftTeams = useQuery(api.infinidraft.draft.teams.listSeasonTeams, {
    seasonId,
  });
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const allRankings = useQuery(api.rankings.getAllRankings, { week: WEEK });
  const rookieFpids = useRookieFpids();
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
  const picks = useQuery(api.infinidraft.draft.picks.listDraftPicks, { seasonId });
  const priceHistory = useQuery(api.infinidraft.draft.history.getPlayerPriceHistory, {
    seasonId,
  });
  const addKeeper = useMutation(api.infinidraft.draft.picks.addKeeper);
  const removeKeeper = useMutation(api.infinidraft.draft.picks.removeKeeper);
  const setKeeperStreak = useMutation(api.infinidraft.draft.picks.setKeeperStreak);
  const setKeeperPriceMutation = useMutation(api.infinidraft.draft.picks.setKeeperPrice);
  const setKeeperRoundMutation = useMutation(api.infinidraft.draft.picks.setKeeperRound);
  const setKeeperTeamMutation = useMutation(api.infinidraft.draft.picks.setKeeperTeam);

  const [keeperSearch, setKeeperSearch] = useState("");
  const [keeperTeamId, setKeeperTeamId] = useState<Id<"seasonTeams"> | null>(
    null,
  );
  const [keeperPrice, setKeeperPrice] = useState<number>(1);
  const [keeperError, setKeeperError] = useState<string | null>(null);
  const [selectedFpid, setSelectedFpid] = useState<number | null>(null);
  const [manualEntryOpened, setManualEntryOpened] = useState(false);
  const [editingPickId, setEditingPickId] = useState<Id<"draftPicks"> | null>(
    null,
  );

  // Default the keeper team picker to the self team once teams exist,
  // mirroring DraftTab's nominatingTeamId default.
  useEffect(() => {
    if (keeperTeamId || !draftTeams) return;
    const selfTeam = draftTeams.find((team) => team.isSelf);
    if (selfTeam) setKeeperTeamId(selfTeam._id);
  }, [draftTeams, keeperTeamId]);

  const activePositions = useMemo(() => {
    if (!settings) return [];
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
    for (const ranking of allRankings ?? []) {
      map.set(ranking.fpid, ranking);
    }
    return map;
  }, [allRankings]);

  const draftValueByFpid = useMemo(() => {
    const map = new Map<number, { dollarValue: number }>();
    for (const value of draftValues ?? []) {
      map.set(value.fpid, value);
    }
    // Kept players are excluded from `draftValues` itself (they're off the
    // auction board - see convex/draftValues.ts's computeDraftValues), so
    // their fair value comes from a separate interpolated estimate instead.
    // Fpids never overlap between the two sources, so this merge can't
    // clobber a real auctioned value.
    for (const value of draftValuesResult?.keeperValues ?? []) {
      map.set(value.fpid, value);
    }
    return map;
  }, [draftValues, draftValuesResult]);

  const draftedFpids = useMemo(
    () => new Set((picks ?? []).map((pick) => pick.fpid)),
    [picks],
  );

  const nameByFpid = useMemo(() => {
    const map = new Map<number, { name: string; team: string | null }>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, row);
    }
    return map;
  }, [allProjections]);

  const keeperSearchResults = useMemo(() => {
    if (!allProjections || !settings || keeperSearch.trim().length < 2) {
      return [];
    }
    const relevant = filterRelevantPlayers(
      allProjections,
      activePositions,
      settings.scoring,
      adpByFpid,
      (row) => pointsForScoringConfig(row, scoringConfigFromSeason(settings)),
    );
    const query = keeperSearch.trim().toLowerCase();
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
      .slice(0, 8);
  }, [
    allProjections,
    settings,
    keeperSearch,
    activePositions,
    adpByFpid,
    draftedFpids,
    draftValueByFpid,
  ]);

  const keepers = useMemo(
    () => (picks ?? []).filter((pick) => pick.isKeeper),
    [picks],
  );

  // (teamId, fpid) pairs already confirmed as keepers - lets
  // SleeperKeeperSuggestions drop a row the instant its own "Add" succeeds,
  // just by re-filtering against this set on the next render.
  const existingKeeperKeys = useMemo(
    () => new Set(keepers.map((pick) => keeperPairKey(pick.teamId, pick.fpid))),
    [keepers],
  );

  // Resolved live from `keepers` every render (rather than storing the
  // clicked-on pick doc directly) so the edit modal reflects each field's
  // latest value as it's changed, instead of freezing on whatever the pick
  // looked like at the moment it was opened.
  const editingPick = editingPickId
    ? (keepers.find((pick) => pick._id === editingPickId) ?? null)
    : null;

  const atTeamKeeperCap = useMemo(() => {
    const maxKeepersPerTeam = settings?.keeperRules?.maxKeepersPerTeam;
    if (maxKeepersPerTeam === undefined || !keeperTeamId) return false;
    const teamKeeperCount = keepers.filter(
      (pick) => pick.teamId === keeperTeamId,
    ).length;
    return teamKeeperCount >= maxKeepersPerTeam;
  }, [settings, keeperTeamId, keepers]);

  const handleAddKeeper = async (
    fpid: number,
    position: Position,
    // Dollar price for an auction league, draft-slot round for a snake/
    // linear one (SNAKE_DRAFT.md §8) - isSnakeOrLinear below decides which
    // addKeeper arg this actually becomes.
    cost: number,
    // Overrides the search form's currently-selected team - used by
    // RecommendedKeepers' quick-add (handleQuickAddKeeper below), which
    // resolves its own team from a confirmed manual-entry roster and
    // shouldn't depend on whatever's sitting in the search form's picker.
    teamIdOverride?: Id<"seasonTeams">,
  ) => {
    const teamId = teamIdOverride ?? keeperTeamId;
    if (!settings || !teamId) return;
    setKeeperError(null);
    try {
      const team = draftTeams?.find((t) => t._id === teamId);
      let planSlotKey: string | undefined;
      if (team?.isSelf) {
        const selfKeeperSlotKeys = new Set(
          keepers
            .filter((pick) => pick.teamId === teamId)
            .map((pick) => pick.planSlotKey)
            .filter((key): key is string => !!key),
        );
        planSlotKey = assignSlotForPick(
          position,
          settings.rosterSlots,
          selfKeeperSlotKeys,
          settings.flexPositions,
          settings.superflexPositions,
        );
      }
      await addKeeper({
        seasonId,
        teamId,
        fpid,
        ...(isSnakeOrLinear ? { round: cost } : { price: cost }),
        ...(planSlotKey ? { planSlotKey } : {}),
      });
      setKeeperSearch("");
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to add keeper."));
    }
  };

  // Recommended Keepers' "Add" button adds the keeper outright rather than
  // just dropping the name into the search box - that old behavior left the
  // search dropdown closed (it only opens on focus/typing, not a
  // programmatic value change) so nothing appeared to happen. Team is
  // resolved from the recommendation's confirmed manual-entry team name
  // when there is one (see getPlayerPriceHistory), falling back to whatever
  // team the search form currently has selected (defaults to the self
  // team) otherwise - either way it's just a starting point, editable
  // afterward via the Current Keepers table/cards below.
  const handleQuickAddKeeper = (
    fpid: number,
    position: Position,
    price: number,
    teamName: string | undefined,
  ) => {
    const matchedTeamId = teamName
      ? draftTeams?.find((t) => t.name === teamName)?._id
      : undefined;
    void handleAddKeeper(fpid, position, price, matchedTeamId);
  };

  const handleRemoveKeeper = async (pickId: Id<"draftPicks">) => {
    setKeeperError(null);
    try {
      await removeKeeper({ pickId });
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to remove keeper."));
    }
  };

  const handleSetStreak = async (pickId: Id<"draftPicks">, streak: number) => {
    setKeeperError(null);
    try {
      await setKeeperStreak({ pickId, streak });
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to update keeper streak."));
    }
  };

  const handleSetPrice = async (pickId: Id<"draftPicks">, price: number) => {
    setKeeperError(null);
    try {
      await setKeeperPriceMutation({ pickId, price });
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to update keeper price."));
    }
  };

  const handleSetRound = async (pickId: Id<"draftPicks">, round: number) => {
    setKeeperError(null);
    try {
      await setKeeperRoundMutation({ pickId, round });
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to update keeper round."));
    }
  };

  const handleSetTeam = async (
    pickId: Id<"draftPicks">,
    teamId: Id<"seasonTeams">,
  ) => {
    setKeeperError(null);
    try {
      await setKeeperTeamMutation({ pickId, teamId });
    } catch (err) {
      setKeeperError(getErrorMessage(err, "Failed to update keeper team."));
    }
  };

  if (settingsList === undefined || draftTeams === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  if (!settings) {
    return <Text c="dimmed">No league settings configured yet.</Text>;
  }

  if (draftTeams.length === 0) {
    return <Text c="dimmed">No draft teams yet.</Text>;
  }

  return (
    <Stack gap="md" py="sm">
      {/* 6/6 split from "md" up - keeper rules on the left, add-a-keeper
          stacked on top of current keepers on the right. Single stacked
          column below that where there isn't room. */}
      <Grid gutter="md" align="start">
        <Grid.Col span={{ base: 12, md: 6 }}>
          {/* No outer Card - KeeperRulesPanel already organizes itself into
              its own Cards (default formula, limits, per tier), so wrapping
              it here would nest a Card inside a Card. */}
          <KeeperRulesPanel settings={settings} />
        </Grid.Col>

        {/* Only meaningful once the two columns collapse into one stacked
            column below "md" - side by side above that, there's no shared
            edge between Rules and Add a Keeper to divide. */}
        <Grid.Col span={12} hiddenFrom="md">
          <Divider />
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack gap="md">
            <Stack gap="md">
              <Text size="md" fw={500}>
                Add a Keeper
              </Text>
              {usingGenericValues && <GenericValuesNotice />}
              <SleeperKeeperSuggestions
                seasonId={seasonId}
                sleeperLeagueId={settings.sleeperLeagueId}
                draftTeams={draftTeams}
                allProjections={allProjections}
                priceHistory={priceHistory}
                keeperRules={settings.keeperRules}
                existingKeeperKeys={existingKeeperKeys}
                rookieFpids={rookieFpids}
                isSnakeOrLinear={isSnakeOrLinear}
                onAddKeeper={handleAddKeeper}
                onSelectPlayer={setSelectedFpid}
              />
              <RecommendedKeepers
                priceHistory={priceHistory}
                keeperRules={settings.keeperRules}
                draftValueByFpid={draftValueByFpid}
                allProjections={allProjections}
                activePositions={activePositions}
                draftedFpids={draftedFpids}
                isSnakeOrLinear={isSnakeOrLinear}
                availableValues={draftValues ?? []}
                teamCount={settings.teamCount}
                draftTeams={draftTeams}
                onQuickAdd={handleQuickAddKeeper}
                onSelectPlayer={setSelectedFpid}
                onOpenManualEntry={() => setManualEntryOpened(true)}
              />
              {/* No outer Card here - KeeperSearchForm already boxes the
                  selected-candidate summary in its own Card once a player is
                  picked, so wrapping this whole section would nest one Card
                  inside another. */}
              <KeeperSearchForm
                keeperSearch={keeperSearch}
                onKeeperSearchChange={setKeeperSearch}
                draftTeams={draftTeams}
                keeperTeamId={keeperTeamId}
                onKeeperTeamIdChange={setKeeperTeamId}
                keeperPrice={keeperPrice}
                onKeeperPriceChange={setKeeperPrice}
                keeperError={keeperError}
                keeperSearchResults={keeperSearchResults}
                rookieFpids={rookieFpids}
                draftValueByFpid={draftValueByFpid}
                priceHistory={priceHistory}
                keeperRules={settings.keeperRules}
                isSnakeOrLinear={isSnakeOrLinear}
                atTeamKeeperCap={atTeamKeeperCap}
                onAddKeeper={handleAddKeeper}
                onSelectPlayer={setSelectedFpid}
              />
            </Stack>

            <Divider />

            <Stack gap="md">
              <Text size="md" fw={500}>
                Current Keepers
              </Text>
              {keepers.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No keepers assigned yet.
                </Text>
              ) : (
                <KeeperCardList
                  keepers={keepers}
                  nameByFpid={nameByFpid}
                  rookieFpids={rookieFpids}
                  teams={draftTeams}
                  draftValueByFpid={draftValueByFpid}
                  onRemove={handleRemoveKeeper}
                  onEdit={(pick) => setEditingPickId(pick._id)}
                  onSelectPlayer={setSelectedFpid}
                  showStreakInput={
                    settings.keeperRules?.maxConsecutiveYears !== undefined
                  }
                  isSnakeOrLinear={isSnakeOrLinear}
                />
              )}
            </Stack>
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

      <ManualPreviousSeasonModal
        seasonId={seasonId}
        currentYear={settings.year}
        opened={manualEntryOpened}
        onClose={() => setManualEntryOpened(false)}
        isSnakeOrLinear={isSnakeOrLinear}
      />

      <KeeperEditModal
        pick={editingPick}
        playerName={
          editingPick
            ? (nameByFpid.get(editingPick.fpid)?.name ?? `#${editingPick.fpid}`)
            : ""
        }
        teams={draftTeams}
        showStreakInput={
          settings.keeperRules?.maxConsecutiveYears !== undefined
        }
        onClose={() => setEditingPickId(null)}
        onSetPrice={handleSetPrice}
        onSetRound={handleSetRound}
        onSetTeam={handleSetTeam}
        onSetStreak={handleSetStreak}
        onRemove={handleRemoveKeeper}
      />
    </Stack>
  );
}
