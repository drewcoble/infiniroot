import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import type { Id } from '@infinidata/dataModel';
import { useAuctionDashboard, type AuctionDashboardRow } from '@shared-core/useAuctionDashboard';
import { AppText, Card, Loading, Screen, colors } from '@/components/ui';

// The native counterpart to infinifaab (web)'s league/$leagueId/index.tsx
// Dashboard tab - same data hook (useAuctionDashboard), same "already
// sorted FAAB-remaining descending by the backend" assumption, rebuilt
// with RN primitives instead of Mantine's Card/Group/Text (see
// INFINIFAAB_MOBILE_PLAN.md for why the JSX itself isn't shared).
export default function SeasonDashboardScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  // Two independent reasons to hold off mounting DashboardTab:
  // 1. Tabs.Screen siblings can mount before the route's params have
  //    propagated - guard here rather than in useAuctionDashboard (shared
  //    with web, where this race doesn't happen) so the query never fires
  //    with an undefined seasonId.
  // 2. Unlike the JS `Tabs` this replaced, NativeTabs renders every tab's
  //    content simultaneously regardless of which is focused (confirmed in
  //    expo-router's own source - NativeTabsView.ios.js maps over every
  //    tab unconditionally). With all 5 season tabs mounted at once, every
  //    tab's Convex queries stay subscribed at the same time - about a
  //    dozen concurrent subscriptions sharing one WebSocket, which is what
  //    was causing queries to hang after switching tabs. Only mounting
  //    each tab's data-fetching component while it's actually focused
  //    keeps just the visible tab's queries subscribed.
  const isFocused = useIsFocused();
  return !seasonId || !isFocused ? (
    <Loading />
  ) : (
    <DashboardTab seasonId={seasonId as Id<'seasons'>} />
  );
}

function DashboardTab({ seasonId }: { seasonId: Id<'seasons'> }) {
  const rows = useAuctionDashboard(seasonId);

  return rows === undefined ? <Loading /> : <DashboardList rows={rows} />;
}

function DashboardList({ rows }: { rows: AuctionDashboardRow[] }) {
  return (
    <Screen>
      <FlatList<AuctionDashboardRow>
        contentContainerStyle={styles.listContent}
        data={rows}
        keyExtractor={(row) => row.teamId}
        ListEmptyComponent={
          <AppText variant="dimmed">No teams found for this league yet.</AppText>
        }
        renderItem={({ item, index }) => (
          <Card style={styles.row}>
            <AppText variant="dimmed" style={styles.rank}>
              {index + 1}
            </AppText>
            <View style={styles.teamName}>
              <AppText numberOfLines={1}>{item.teamName}</AppText>
              {item.activeWinningBids > 0 && (
                <AppText style={{ color: colors.primary }}>
                  Winning {item.activeWinningBids}
                </AppText>
              )}
            </View>
            <AppText style={styles.faab}>${item.faabRemaining}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rank: {
    width: 24,
    textAlign: 'right',
  },
  teamName: {
    flex: 1,
    gap: 2,
  },
  faab: {
    fontWeight: '700',
  },
});
