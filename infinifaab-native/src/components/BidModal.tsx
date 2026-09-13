import { useState } from 'react';
import { Modal, Pressable, TextInput, View, StyleSheet } from 'react-native';
import type { Id } from '@infinidata/dataModel';
import { usePlaceBid } from '@shared-core/usePlaceBid';
import { AppText, Button, Chip, colors } from './ui';

export interface BidModalTarget {
  fpid: number;
  name: string;
  initialAmount: number;
}

interface BidModalProps {
  seasonId: Id<'seasons'>;
  target: BidModalTarget | null;
  onClose: () => void;
  teams: { teamId: string; name: string }[];
}

// The native counterpart to infinifaab (web)'s components/BidModal.tsx -
// same usePlaceBid mutation and submit-lifecycle state, rebuilt as an RN
// Modal (team picker as pressable chips instead of a Select, since a
// native season only ever has a couple of teams to bid as) rather than
// Mantine's Modal/Select (see INFINIFAAB_MOBILE_PLAN.md for why the JSX
// itself isn't shared). Shared between the My Bids and Players tabs, same
// as web - Players isn't ported yet, but My Bids alone already justifies
// pulling this out of the screen file.
export function BidModal({ seasonId, target, onClose, teams }: BidModalProps) {
  return (
    <Modal visible={target !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* Keyed on fpid so opening a *different* target remounts the form
            with fresh state, instead of an effect syncing it after the
            fact - see https://react.dev/learn/you-might-not-need-an-effect
            ("Resetting all state when a prop changes"). */}
        {target && (
          <BidModalForm
            key={target.fpid}
            seasonId={seasonId}
            target={target}
            teams={teams}
            onClose={onClose}
          />
        )}
      </View>
    </Modal>
  );
}

function BidModalForm({
  seasonId,
  target,
  teams,
  onClose,
}: {
  seasonId: Id<'seasons'>;
  target: BidModalTarget;
  teams: { teamId: string; name: string }[];
  onClose: () => void;
}) {
  const placeBid = usePlaceBid();
  const [bidTeamId, setBidTeamId] = useState<string | null>(teams[0]?.teamId ?? null);
  const [bidAmount, setBidAmount] = useState(String(target.initialAmount));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = Number(bidAmount);
  const isValidAmount = bidAmount !== '' && Number.isFinite(amount) && amount >= 0;

  const handleSubmit = async () => {
    if (!bidTeamId || !isValidAmount) return;
    setSubmitting(true);
    setError(null);
    try {
      await placeBid({
        seasonId,
        teamId: bidTeamId as Id<'seasonTeams'>,
        fpid: target.fpid,
        maxBid: amount,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <AppText variant="title" numberOfLines={1}>
        Bid on {target.name}
      </AppText>

      {teams.length > 1 && (
        <View style={styles.field}>
          <AppText variant="dimmed">Bidding as</AppText>
          <View style={styles.teamRow}>
            {teams.map((t) => (
              <Chip
                key={t.teamId}
                label={t.name}
                active={bidTeamId === t.teamId}
                onPress={() => setBidTeamId(t.teamId)}
              />
            ))}
          </View>
        </View>
      )}

      <View style={styles.field}>
        <AppText variant="dimmed">Your max bid</AppText>
        <TextInput
          value={bidAmount}
          onChangeText={setBidAmount}
          keyboardType="number-pad"
          placeholder="$0"
          placeholderTextColor={colors.textDimmed}
          style={styles.input}
        />
        <AppText variant="dimmed" style={styles.hint}>
          Kept private - only the price needed to beat the next-highest bidder is ever shown.
        </AppText>
      </View>

      {error && <AppText style={{ color: colors.danger }}>{error}</AppText>}

      <View style={styles.actions}>
        <Pressable onPress={onClose} disabled={submitting} style={styles.cancelButton}>
          <AppText variant="dimmed">Cancel</AppText>
        </Pressable>
        <View style={styles.placeBidButton}>
          <Button
            title="Place Bid"
            loading={submitting}
            disabled={!bidTeamId || !isValidAmount}
            onPress={() => void handleSubmit()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    gap: 16,
  },
  field: {
    gap: 6,
  },
  teamRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  hint: {
    fontSize: 12,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  placeBidButton: {
    minWidth: 130,
  },
});
