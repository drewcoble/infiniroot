import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { Id } from '@infinidata/dataModel';
import type { CycleType } from '@shared-core/CycleType';
import { formatCountdown } from '@shared-core/countdown';
import { useAuctionBoardState, type AuctionBoardRow } from '@shared-core/useAuctionBoardState';
import { useAuctionSettings } from '@shared-core/useAuctionSettings';
import { useBidsBoard, type BidBoardRow } from '@shared-core/useBidsBoard';
import { useCloseAuctionCycleNow } from '@shared-core/useCloseAuctionCycleNow';
import {
  useManualCycleCandidates,
  type ManualCycleCandidateRow,
} from '@shared-core/useManualCycleCandidates';
import { useMyBids, type MyBidRow } from '@shared-core/useMyBids';
import { useMyParticipation } from '@shared-core/useMyParticipation';
import { useOpenAuctionCycleNow } from '@shared-core/useOpenAuctionCycleNow';
import { useRookieFpids } from '@shared-core/useRookieFpids';
import { useStartManualAuctionCycle } from '@shared-core/useStartManualAuctionCycle';
import { useWaiverEligiblePlayers, type WaiverPlayerRow } from '@shared-core/useWaiverEligiblePlayers';
import { BidModal, type BidModalTarget } from '@/components/BidModal';
import { AppText, Button, Card, GlassCard, Loading, NumberField, Screen, colors } from '@/components/ui';

// The native counterpart to infinifaab (web)'s league/$leagueId/
// players.tsx - the hardest of the four tabs per INFINIFAAB_MOBILE_PLAN.md
// (last ported, budgeted the most time). Same 8 queries/3 mutations and
// the same board/myBids/bidsBoard merge-by-"cycleId:fpid" logic as web,
// but two differences worth calling out:
//  - No @tanstack/react-virtual equivalent needed - RN's FlatList already
//    windows its rendering by default, unlike a DOM list where that has to
//    be opted into.
//  - No native combobox/MultiSelect primitive exists, so the manual-cycle
//    player picker (commissioner-only) is a search-and-tap bottom sheet
//    (ManualCyclePicker below) instead - same underlying selection state,
//    different input shape.
const CYCLE_TYPE_LABEL: Record<CycleType, string | null> = {
  weekly: null,
  playerDrop: 'Drop window',
  manual: 'Commissioner cycle',
};

function boardKey(cycleId: string, fpid: number): string {
  return `${cycleId}:${fpid}`;
}

export default function SeasonPlayersScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  // !seasonId guards the Tabs.Screen-siblings-mount-before-params-
  // propagate race; !isFocused keeps this tab's 8 queries (the heaviest
  // of the five) unsubscribed while another tab is showing, since
  // NativeTabs mounts every tab's content at once regardless of focus -
  // see index.tsx's SeasonDashboardScreen for the full explanation.
  const isFocused = useIsFocused();
  return !seasonId || !isFocused ? (
    <Loading />
  ) : (
    <PlayersTab seasonId={seasonId as Id<'seasons'>} />
  );
}

function PlayersTab({ seasonId }: { seasonId: Id<'seasons'> }) {
  const players = useWaiverEligiblePlayers(seasonId);
  const board = useAuctionBoardState(seasonId);
  const myBids = useMyBids(seasonId);
  const bidsBoard = useBidsBoard(seasonId);
  const participation = useMyParticipation(seasonId);
  const settings = useAuctionSettings(seasonId);
  const rookieFpidSet = useRookieFpids();
  const isCommissioner = participation?.isCommissioner ?? false;
  const manualCandidates = useManualCycleCandidates(seasonId, isCommissioner);

  const openCycleNow = useOpenAuctionCycleNow();
  const closeCycleNow = useCloseAuctionCycleNow();
  const startManualCycle = useStartManualAuctionCycle();

  const [bidTarget, setBidTarget] = useState<BidModalTarget | null>(null);
  const [testDuration, setTestDuration] = useState(60);
  const [cycleActionError, setCycleActionError] = useState<string | null>(null);
  const [cycleActionLoading, setCycleActionLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [manualFpids, setManualFpids] = useState<number[]>([]);
  const [manualDuration, setManualDuration] = useState(60);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const query = search.trim().toLowerCase();
  const filteredPlayers = useMemo(
    () => (players ?? []).filter((row) => (query ? row.name.toLowerCase().includes(query) : true)),
    [players, query],
  );

  const { categoryByKey, boardByKey, myBidsByKey } = useMemo(() => {
    const categoryByKey = new Map<string, BidBoardRow['category']>();
    for (const row of bidsBoard ?? []) categoryByKey.set(boardKey(row.cycleId, row.fpid), row.category);
    const boardByKey = new Map<string, AuctionBoardRow>();
    for (const row of board?.rows ?? []) boardByKey.set(boardKey(row.cycleId, row.fpid), row);
    const myBidsByKey = new Map<string, MyBidRow[]>();
    for (const bid of myBids ?? []) {
      const key = boardKey(bid.cycleId, bid.fpid);
      const list = myBidsByKey.get(key) ?? [];
      list.push(bid);
      myBidsByKey.set(key, list);
    }
    return { categoryByKey, boardByKey, myBidsByKey };
  }, [bidsBoard, board, myBids]);

  if (
    players === undefined ||
    board === undefined ||
    myBids === undefined ||
    bidsBoard === undefined ||
    participation === undefined ||
    settings === undefined
  ) {
    return <Loading />;
  }

  const weeklyCycle = board.openCycles.find((c) => (c.type ?? 'weekly') === 'weekly') ?? null;
  const selectedCandidates = (manualCandidates ?? []).filter((c) => manualFpids.includes(c.fpid));

  const openBidModal = (row: WaiverPlayerRow) => {
    if (!row.cycleId) return;
    const key = boardKey(row.cycleId, row.fpid);
    const existingMax = myBidsByKey.get(key)?.[0]?.maxBid;
    const boardRow = boardByKey.get(key);
    const initialAmount =
      existingMax !== undefined
        ? existingMax + settings.minIncrement
        : boardRow
          ? boardRow.currentPrice
          : settings.startingBid;
    setBidTarget({ fpid: row.fpid, name: row.name, initialAmount });
  };

  const handleOpenNow = async () => {
    setCycleActionLoading(true);
    setCycleActionError(null);
    try {
      await openCycleNow({ seasonId, durationMinutes: testDuration });
    } catch (err) {
      setCycleActionError(err instanceof Error ? err.message : 'Failed to open the auction.');
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleCloseNow = async () => {
    setCycleActionLoading(true);
    setCycleActionError(null);
    try {
      await closeCycleNow({ seasonId });
    } catch (err) {
      setCycleActionError(err instanceof Error ? err.message : 'Failed to close the auction.');
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleStartManualCycle = async () => {
    if (manualFpids.length === 0) return;
    setManualLoading(true);
    setManualError(null);
    try {
      await startManualCycle({ seasonId, fpids: manualFpids, durationMinutes: manualDuration });
      setManualFpids([]);
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Failed to start the bid cycle.');
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <Screen>
      <FlatList
        data={filteredPlayers}
        keyExtractor={(row) => String(row.fpid)}
        contentContainerStyle={styles.listContent}
        initialNumToRender={16}
        ListHeaderComponent={
          <View style={styles.header}>
            {!weeklyCycle ? (
              <View style={styles.banner}>
                <AppText style={styles.bannerText}>
                  No weekly auction window is open right now
                  {!settings.enabled ? ' and the weekly schedule is off.' : ' - check back soon.'}
                </AppText>
                {isCommissioner && (
                  <View style={styles.inlineRow}>
                    <NumberField value={testDuration} onChange={setTestDuration} min={1} />
                    <View style={styles.actionButton}>
                      <Button
                        title="Open auction now"
                        loading={cycleActionLoading}
                        onPress={() => void handleOpenNow()}
                      />
                    </View>
                  </View>
                )}
              </View>
            ) : (
              <View style={styles.inlineRow}>
                <AppText variant="dimmed">Closes in {formatCountdown(weeklyCycle.closesAt)}</AppText>
                {isCommissioner && (
                  <Pressable
                    onPress={() => void handleCloseNow()}
                    disabled={cycleActionLoading}
                    style={styles.smallDangerButton}
                  >
                    <AppText style={styles.smallDangerButtonText}>
                      {cycleActionLoading ? 'Closing…' : 'Close now'}
                    </AppText>
                  </Pressable>
                )}
              </View>
            )}
            {cycleActionError && <AppText style={{ color: colors.danger }}>{cycleActionError}</AppText>}

            {isCommissioner && (
              <Card style={styles.manualCard}>
                <AppText variant="title" style={styles.manualTitle}>
                  Start a bid cycle for specific players
                </AppText>
                <AppText variant="dimmed">
                  Hand-pick one or more free agents (not currently on a roster or in another
                  open bid cycle) and run a dedicated auction for them, independent of the
                  weekly schedule.
                </AppText>
                <Pressable onPress={() => setPickerOpen(true)} style={styles.pickerButton}>
                  <AppText numberOfLines={1} variant={selectedCandidates.length === 0 ? 'dimmed' : 'body'}>
                    {selectedCandidates.length > 0
                      ? selectedCandidates.map((c) => c.name).join(', ')
                      : 'Select players...'}
                  </AppText>
                </Pressable>
                <View style={styles.inlineRow}>
                  <NumberField value={manualDuration} onChange={setManualDuration} min={1} />
                  <View style={styles.actionButton}>
                    <Button
                      title="Start bid cycle"
                      loading={manualLoading}
                      disabled={manualFpids.length === 0}
                      onPress={() => void handleStartManualCycle()}
                    />
                  </View>
                </View>
                {manualError && <AppText style={{ color: colors.danger }}>{manualError}</AppText>}
              </Card>
            )}

            {players.length > 0 && (
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search players..."
                placeholderTextColor={colors.textDimmed}
                style={styles.searchInput}
              />
            )}

            {players.length === 0 && (
              <AppText variant="dimmed" style={styles.emptyText}>
                No players are currently on waivers.
              </AppText>
            )}
            {players.length > 0 && filteredPlayers.length === 0 && (
              <AppText variant="dimmed" style={styles.emptyText}>
                No players match your search.
              </AppText>
            )}
          </View>
        }
        renderItem={({ item: row }) => {
          const key = row.cycleId ? boardKey(row.cycleId, row.fpid) : null;
          const boardRow = key ? boardByKey.get(key) : undefined;
          const myMax = key ? myBidsByKey.get(key)?.[0]?.maxBid : undefined;
          const category = key ? categoryByKey.get(key) : undefined;
          return (
            <PlayerRow
              row={row}
              isRookie={rookieFpidSet.has(row.fpid)}
              boardRow={boardRow}
              myMax={myMax}
              category={category}
              disabled={!row.cycleId || participation.teams.length === 0}
              onBid={() => openBidModal(row)}
            />
          );
        }}
      />

      <BidModal
        seasonId={seasonId}
        target={bidTarget}
        onClose={() => setBidTarget(null)}
        teams={participation.teams}
      />

      <ManualCyclePicker
        visible={pickerOpen}
        candidates={manualCandidates}
        selected={manualFpids}
        onToggle={(fpid) =>
          setManualFpids((prev) =>
            prev.includes(fpid) ? prev.filter((f) => f !== fpid) : [...prev, fpid],
          )
        }
        onClose={() => setPickerOpen(false)}
      />
    </Screen>
  );
}

function PlayerRow({
  row,
  isRookie,
  boardRow,
  myMax,
  category,
  disabled,
  onBid,
}: {
  row: WaiverPlayerRow;
  isRookie: boolean;
  boardRow: AuctionBoardRow | undefined;
  myMax: number | undefined;
  category: BidBoardRow['category'] | undefined;
  disabled: boolean;
  onBid: () => void;
}) {
  const statusColor =
    category === 'winning' ? colors.primary : category === 'outbid' ? colors.danger : colors.text;
  const cycleLabel = CYCLE_TYPE_LABEL[row.cycleType];

  return (
    <GlassCard style={styles.row}>
      <View style={styles.rowHeader}>
        <AppText numberOfLines={1} style={styles.playerName}>
          {row.name}
        </AppText>
        {isRookie && <AppText style={styles.rookieBadge}>R</AppText>}
        {row.injury && <AppText style={styles.injuryBadge}>{row.injury.statusShort}</AppText>}
      </View>
      <AppText variant="dimmed" numberOfLines={1}>
        {row.position}
        {row.positionRank > 0 ? row.positionRank : ''}
        {row.team ? ` · ${row.team}` : ''}
      </AppText>
      <View style={styles.rowFooter}>
        <View style={styles.rowStatus}>
          {boardRow && (
            <>
              <AppText numberOfLines={1} style={[styles.price, { color: statusColor }]}>
                ${boardRow.currentPrice}
                {boardRow.leadingTeamName ? ` - ${boardRow.leadingTeamName}` : ''}
              </AppText>
              <AppText variant="dimmed" numberOfLines={1}>
                ({boardRow.bidCount} bid{boardRow.bidCount === 1 ? '' : 's'})
                {myMax !== undefined ? ` - your max: $${myMax}` : ''}
              </AppText>
            </>
          )}
          {(cycleLabel || row.closesAt !== undefined) && (
            <AppText variant="dimmed" numberOfLines={1}>
              {cycleLabel ?? ''}
              {cycleLabel && row.closesAt !== undefined ? ' - ' : ''}
              {row.closesAt !== undefined ? `closes in ${formatCountdown(row.closesAt)}` : ''}
            </AppText>
          )}
        </View>
        <Pressable
          onPress={onBid}
          disabled={disabled}
          style={[styles.bidButton, disabled && styles.bidButtonDisabled]}
        >
          <AppText style={styles.bidButtonText}>Bid</AppText>
        </Pressable>
      </View>
    </GlassCard>
  );
}

function ManualCyclePicker({
  visible,
  candidates,
  selected,
  onToggle,
  onClose,
}: {
  visible: boolean;
  candidates: ManualCycleCandidateRow[] | undefined;
  selected: number[];
  onToggle: (fpid: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = (candidates ?? []).filter((c) =>
    query ? c.name.toLowerCase().includes(query) : true,
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.pickerSheet}>
          <AppText variant="title">Select players</AppText>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search players..."
            placeholderTextColor={colors.textDimmed}
            style={styles.searchInput}
          />
          {candidates === undefined ? (
            <ActivityIndicator color={colors.primary} style={styles.pickerLoading} />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(c) => String(c.fpid)}
              style={styles.pickerList}
              renderItem={({ item }) => {
                const active = selected.includes(item.fpid);
                return (
                  <Pressable onPress={() => onToggle(item.fpid)} style={styles.pickerRow}>
                    <AppText numberOfLines={1} style={styles.pickerRowText}>
                      {item.name} ({item.position}
                      {item.team ? ` - ${item.team}` : ''})
                    </AppText>
                    <AppText style={{ color: active ? colors.primary : colors.textDimmed }}>
                      {active ? '✓' : ''}
                    </AppText>
                  </Pressable>
                );
              }}
            />
          )}
          <View style={styles.pickerActions}>
            <Button title="Done" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 8,
  },
  header: {
    gap: 12,
    marginBottom: 8,
  },
  banner: {
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  bannerText: {
    color: colors.primary,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  smallDangerButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  smallDangerButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  manualCard: {
    gap: 10,
  },
  manualTitle: {
    fontSize: 16,
  },
  pickerButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: 24,
  },
  row: {
    gap: 4,
    marginBottom: 8,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playerName: {
    flex: 1,
    fontWeight: '500',
  },
  rookieBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  injuryBadge: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  rowStatus: {
    flex: 1,
    gap: 2,
  },
  price: {
    fontWeight: '700',
  },
  bidButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  bidButtonDisabled: {
    opacity: 0.5,
  },
  bidButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
    maxHeight: '80%',
  },
  pickerLoading: {
    marginVertical: 16,
  },
  pickerList: {
    maxHeight: 360,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  pickerRowText: {
    flex: 1,
    color: colors.text,
  },
  pickerActions: {
    alignItems: 'flex-end',
  },
});
