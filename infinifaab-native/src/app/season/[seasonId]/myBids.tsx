import { useGlobalSearchParams, useIsFocused } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { Id } from '@infinidata/dataModel';
import { formatCountdown } from '@shared-core/countdown';
import { useAuctionSettings } from '@shared-core/useAuctionSettings';
import { useBidsBoard, type BidBoardRow } from '@shared-core/useBidsBoard';
import { useMyParticipation } from '@shared-core/useMyParticipation';
import { BidModal, type BidModalTarget } from '@/components/BidModal';
import { AppText, GlassCard, Loading, Screen, colors } from '@/components/ui';

// The native counterpart to infinifaab (web)'s league/$leagueId/myBids.tsx
// - same three queries (useBidsBoard/useMyParticipation/useAuctionSettings)
// and winning/outbid/other grouping, rebuilt with RN primitives instead of
// the shared web PlayerCard (see INFINIFAAB_MOBILE_PLAN.md for why the JSX
// itself isn't shared - BidRow below is this screen's own spare card, not
// a native port of PlayerCard's full prop surface, which only the not-yet-
// ported Players tab actually needs).
const SECTIONS: { category: BidBoardRow['category']; title: string }[] = [
  { category: 'winning', title: 'Winning' },
  { category: 'outbid', title: 'Outbid' },
  { category: 'other', title: 'Other Bids' },
];

const CYCLE_TYPE_LABEL: Record<BidBoardRow['cycleType'], string | null> = {
  weekly: null,
  playerDrop: 'Drop window',
  manual: 'Commissioner cycle',
};

// dollarsign.ring status indicator, colored by *your* outcome on this
// row - winning is green, outbid (cycle still open, currently losing) is
// yellow. No "lost" red state here: every row on this screen comes from
// an open cycle (useBidsBoard's own comment - "every active bid this
// cycle"), so a genuinely closed/lost outcome doesn't exist in this data;
// that belongs to the Results tab's AuctionResultRow instead. "other" rows
// (bids from other teams you're not involved in) get no ring at all -
// there's no outcome of yours to show.
const RING_COLOR: Partial<Record<BidBoardRow['category'], string>> = {
  winning: colors.success,
  outbid: colors.warning,
};

export default function SeasonMyBidsScreen() {
  // useGlobalSearchParams, not useLocalSearchParams - see results.tsx's
  // comment for why (expo/expo#27472, #27992: dynamic parent segment
  // params don't propagate to sibling NativeTabs screens otherwise).
  const { seasonId } = useGlobalSearchParams<{ seasonId: string }>();
  // !seasonId guards the Tabs.Screen-siblings-mount-before-params-
  // propagate race; !isFocused keeps this tab's queries unsubscribed
  // while another tab is showing, since NativeTabs mounts every tab's
  // content at once regardless of focus - see index.tsx's
  // SeasonDashboardScreen for the full explanation.
  const isFocused = useIsFocused();
  return !seasonId || !isFocused ? (
    <Loading />
  ) : (
    <MyBidsTab seasonId={seasonId as Id<'seasons'>} />
  );
}

function MyBidsTab({ seasonId }: { seasonId: Id<'seasons'> }) {
  const rows = useBidsBoard(seasonId);
  const participation = useMyParticipation(seasonId);
  const settings = useAuctionSettings(seasonId);
  const [bidTarget, setBidTarget] = useState<BidModalTarget | null>(null);

  if (rows === undefined || participation === undefined || settings === undefined) {
    return <Loading />;
  }

  const openBidModal = (row: BidBoardRow) => {
    const initialAmount =
      row.myMaxBid !== null ? row.myMaxBid + settings.minIncrement : row.currentPrice;
    setBidTarget({ fpid: row.fpid, name: row.name, initialAmount });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.listContent}>
        {rows.length === 0 ? (
          <AppText variant="dimmed">No active bids this cycle.</AppText>
        ) : (
          SECTIONS.map(({ category, title }) => {
            const sectionRows = rows.filter((row) => row.category === category);
            if (sectionRows.length === 0) return null;
            return (
              <View key={category} style={styles.section}>
                <AppText variant="title" style={styles.sectionTitle}>
                  {title}
                </AppText>
                {sectionRows.map((row) => (
                  <BidRow
                    key={row.fpid}
                    row={row}
                    disabled={participation.teams.length === 0}
                    onPress={() => openBidModal(row)}
                  />
                ))}
              </View>
            );
          })
        )}
      </ScrollView>

      <BidModal
        seasonId={seasonId}
        target={bidTarget}
        onClose={() => setBidTarget(null)}
        teams={participation.teams}
      />
    </Screen>
  );
}

function BidRow({
  row,
  disabled,
  onPress,
}: {
  row: BidBoardRow;
  disabled: boolean;
  onPress: () => void;
}) {
  const statusColor =
    row.category === 'winning' ? colors.primary : row.category === 'outbid' ? colors.danger : colors.text;
  const cycleLabel = CYCLE_TYPE_LABEL[row.cycleType];
  const ringColor = RING_COLOR[row.category];

  return (
    <GlassCard style={styles.row}>
      <View style={styles.rowHeader}>
        {ringColor && (
          <SymbolView
            name="dollarsign.ring"
            type="monochrome"
            tintColor={ringColor}
            size={18}
          />
        )}
        <AppText numberOfLines={1} style={styles.playerName}>
          {row.name}
        </AppText>
        {row.injury && <AppText style={styles.injuryBadge}>{row.injury.statusShort}</AppText>}
      </View>
      <AppText variant="dimmed" numberOfLines={1}>
        {row.position}
        {row.positionRank > 0 ? row.positionRank : ''}
        {row.team ? ` · ${row.team}` : ''}
      </AppText>
      <View style={styles.rowFooter}>
        <View style={styles.rowStatus}>
          <AppText numberOfLines={1} style={[styles.price, { color: statusColor }]}>
            ${row.currentPrice}
            {row.leadingTeamName ? ` - ${row.leadingTeamName}` : ''}
          </AppText>
          <AppText variant="dimmed" numberOfLines={1}>
            ({row.bidCount} bid{row.bidCount === 1 ? '' : 's'})
            {row.myMaxBid !== null ? ` - your max: $${row.myMaxBid}` : ''}
          </AppText>
          <AppText variant="dimmed" numberOfLines={1}>
            {cycleLabel ? `${cycleLabel} - ` : ''}Closes in {formatCountdown(row.closesAt)}
          </AppText>
        </View>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          style={[styles.bidButton, disabled && styles.bidButtonDisabled]}
        >
          <AppText style={styles.bidButtonText}>
            {row.category === 'other' ? 'Bid' : 'Increase'}
          </AppText>
        </Pressable>
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 20,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
  },
  row: {
    gap: 4,
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
});
