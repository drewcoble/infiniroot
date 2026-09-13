import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { Id } from '@infinidata/dataModel';
import { useAuctionResults, type AuctionResultRow } from '@shared-core/useAuctionResults';
import { AppText, Card, Loading, Screen } from '@/components/ui';

// The native counterpart to infinifaab (web)'s league/$leagueId/results.tsx
// - same data hook (useAuctionResults) and client-side grouping by
// cycleId, rebuilt with RN primitives (see INFINIFAAB_MOBILE_PLAN.md for
// why the JSX itself isn't shared).
export default function SeasonResultsScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  // !seasonId guards the Tabs.Screen-siblings-mount-before-params-
  // propagate race; !isFocused keeps this tab's query unsubscribed while
  // another tab is showing, since NativeTabs mounts every tab's content at
  // once regardless of focus - see index.tsx's SeasonDashboardScreen for
  // the full explanation.
  const isFocused = useIsFocused();
  return !seasonId || !isFocused ? (
    <Loading />
  ) : (
    <ResultsTab seasonId={seasonId as Id<'seasons'>} />
  );
}

function ResultsTab({ seasonId }: { seasonId: Id<'seasons'> }) {
  const results = useAuctionResults(seasonId);

  return results === undefined ? <Loading /> : <ResultsList results={results} />;
}

function ResultsList({ results }: { results: AuctionResultRow[] }) {
  if (results.length === 0) {
    return (
      <Screen style={styles.empty}>
        <AppText variant="dimmed">No auctions have closed yet.</AppText>
      </Screen>
    );
  }

  const cycles = new Map<string, { closesAt: number; rows: AuctionResultRow[] }>();
  for (const row of results) {
    const entry = cycles.get(row.cycleId) ?? { closesAt: row.closesAt, rows: [] };
    entry.rows.push(row);
    cycles.set(row.cycleId, entry);
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.listContent}>
        {[...cycles.entries()].map(([cycleId, { closesAt, rows }]) => (
          <View key={cycleId} style={styles.cycleGroup}>
            <AppText variant="title" style={styles.cycleTitle}>
              {new Date(closesAt).toLocaleDateString()}
            </AppText>
            {rows.map((row) => (
              <Card key={`${cycleId}-${row.fpid}`} style={styles.row}>
                <AppText numberOfLines={1} style={styles.playerName}>
                  {row.playerName ?? `Player #${row.fpid}`}
                </AppText>
                {row.winnerTeamName ? (
                  <>
                    <AppText variant="dimmed" numberOfLines={1} style={styles.winner}>
                      {row.winnerTeamName}
                    </AppText>
                    <AppText style={styles.price}>${row.price}</AppText>
                  </>
                ) : (
                  <AppText variant="dimmed">No winner - cleared waivers before close</AppText>
                )}
              </Card>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    padding: 16,
    gap: 20,
  },
  cycleGroup: {
    gap: 8,
  },
  cycleTitle: {
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerName: {
    flex: 1,
  },
  winner: {
    flex: 1,
  },
  price: {
    fontWeight: '700',
  },
});
