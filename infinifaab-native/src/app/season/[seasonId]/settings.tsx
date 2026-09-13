import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import type { Id } from '@infinidata/dataModel';
import { copyToClipboard } from '@/lib/clipboard';
import { useAuctionSettings, type AuctionSettings } from '@shared-core/useAuctionSettings';
import { useCreateTeamInvite } from '@shared-core/useCreateTeamInvite';
import { useMyParticipation } from '@shared-core/useMyParticipation';
import { useRemoveTeamMember } from '@shared-core/useRemoveTeamMember';
import { useRevokeTeamInvite } from '@shared-core/useRevokeTeamInvite';
import { useTeamInvites, type TeamInviteRow } from '@shared-core/useTeamInvites';
import { useUpdateAuctionSettings } from '@shared-core/useUpdateAuctionSettings';
import { AppText, Button, Card, Chip, Loading, NumberField, Screen, colors } from '@/components/ui';

// The native counterpart to infinifaab (web)'s league/$leagueId/
// settings.tsx - same queries/mutations (useMyParticipation/
// useAuctionSettings/useTeamInvites, useUpdateAuctionSettings/
// useCreateTeamInvite/useRevokeTeamInvite/useRemoveTeamMember), rebuilt
// with RN primitives instead of Mantine's Select/SegmentedControl/
// EditableNumberStepper (see INFINIFAAB_MOBILE_PLAN.md for why the JSX
// itself isn't shared). Invite links point at the web app
// (infinifaab.com) rather than a native deep link - redeeming an invite
// (join/$token) isn't ported yet (see the plan's Phase 4 note), so
// whoever this link goes to is expected to open it in a browser.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TIE_BREAK_OPTIONS: { value: AuctionSettings['tieBreakMode']; label: string }[] = [
  { value: 'earliest', label: 'Earliest bid wins' },
  { value: 'waiverOrder', label: 'Waiver order wins' },
];

const JOIN_BASE_URL = 'https://infinifaab.com/join';

export default function SeasonSettingsScreen() {
  const { seasonId } = useLocalSearchParams<{ seasonId: string }>();
  // !seasonId guards the Tabs.Screen-siblings-mount-before-params-
  // propagate race; !isFocused keeps this tab's queries unsubscribed
  // while another tab is showing, since NativeTabs mounts every tab's
  // content at once regardless of focus - see index.tsx's
  // SeasonDashboardScreen for the full explanation. Side effect: leaving
  // this tab with unsaved form edits and coming back resets them, since
  // that remounts SettingsForm's useState(initialSettings) fresh - an
  // acceptable trade-off for fixing every tab's queries hanging.
  const isFocused = useIsFocused();
  return !seasonId || !isFocused ? (
    <Loading />
  ) : (
    <SettingsTab seasonId={seasonId as Id<'seasons'>} />
  );
}

function SettingsTab({ seasonId }: { seasonId: Id<'seasons'> }) {
  const participation = useMyParticipation(seasonId);
  const settings = useAuctionSettings(seasonId);

  if (participation === undefined || settings === undefined) {
    return <Loading />;
  }

  return (
    <SettingsForm
      seasonId={seasonId}
      isCommissioner={participation.isCommissioner}
      initialSettings={settings}
    />
  );
}

// initialSettings only seeds useState below (a lazy initializer, read
// once) - SettingsTab only ever mounts this once settings has already
// loaded, so there's no "reset the form when the query resolves" race to
// handle with an effect the way the web version's `if (settings && !form)`
// guard does.
function SettingsForm({
  seasonId,
  isCommissioner,
  initialSettings,
}: {
  seasonId: Id<'seasons'>;
  isCommissioner: boolean;
  initialSettings: AuctionSettings;
}) {
  const [form, setForm] = useState<AuctionSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const updateSettings = useUpdateAuctionSettings();

  const invites = useTeamInvites(seasonId, isCommissioner);
  const createInvite = useCreateTeamInvite();
  const revokeInvite = useRevokeTeamInvite();
  const removeMember = useRemoveTeamMember();

  // closeHour is stored/interpreted as 24h Eastern time throughout the
  // backend - this form only converts to/from a 12h + AM/PM display, same
  // as the web version.
  const hour12 = form.closeHour % 12 === 0 ? 12 : form.closeHour % 12;
  const isPM = form.closeHour >= 12;

  const setHour12 = (value: number) => {
    const clamped = Math.min(12, Math.max(1, value));
    setForm((f) => ({ ...f, closeHour: (clamped % 12) + (isPM ? 12 : 0) }));
  };

  const setAmPm = (pm: boolean) => {
    setForm((f) => ({ ...f, closeHour: (hour12 % 12) + (pm ? 12 : 0) }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // No timeZone field - see useUpdateAuctionSettings's own comment on
      // why spreading the whole `form` object would fail Convex's arg
      // validation.
      await updateSettings({
        seasonId,
        enabled: form.enabled,
        closeWeekday: form.closeWeekday,
        closeHour: form.closeHour,
        closeMinute: form.closeMinute,
        minIncrement: form.minIncrement,
        startingBid: form.startingBid,
        antiSnipeMinutes: form.antiSnipeMinutes,
        tieBreakMode: form.tieBreakMode,
        dropCycleDurationHours: form.dropCycleDurationHours,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.listContent}>
        <Card style={styles.card}>
          <AppText variant="title" style={styles.cardTitle}>
            Auction schedule
          </AppText>

          <View style={styles.switchRow}>
            <AppText>Auction enabled</AppText>
            <Switch
              value={form.enabled}
              onValueChange={(value) => setForm((f) => ({ ...f, enabled: value }))}
              disabled={!isCommissioner}
              trackColor={{ true: colors.accent }}
            />
          </View>

          <View style={styles.field}>
            <AppText variant="dimmed">Closes on</AppText>
            <View style={styles.chipRow}>
              {WEEKDAYS.map((label, index) => (
                <Chip
                  key={label}
                  label={label}
                  active={form.closeWeekday === index}
                  disabled={!isCommissioner}
                  onPress={() => setForm((f) => ({ ...f, closeWeekday: index }))}
                />
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <AppText variant="dimmed">Closes at (Eastern Time)</AppText>
            <View style={styles.timeRow}>
              <NumberField
                value={hour12}
                onChange={setHour12}
                min={1}
                max={12}
                disabled={!isCommissioner}
              />
              <AppText>:</AppText>
              <NumberField
                value={form.closeMinute}
                onChange={(value) => setForm((f) => ({ ...f, closeMinute: value }))}
                min={0}
                max={59}
                disabled={!isCommissioner}
              />
              <Chip label="AM" active={!isPM} disabled={!isCommissioner} onPress={() => setAmPm(false)} />
              <Chip label="PM" active={isPM} disabled={!isCommissioner} onPress={() => setAmPm(true)} />
            </View>
          </View>

          <View style={styles.rowFields}>
            <LabeledNumberField
              label="Starting bid ($)"
              value={form.startingBid}
              onChange={(value) => setForm((f) => ({ ...f, startingBid: value }))}
              min={0}
              disabled={!isCommissioner}
            />
            <LabeledNumberField
              label="Min increment ($)"
              value={form.minIncrement}
              onChange={(value) => setForm((f) => ({ ...f, minIncrement: value }))}
              min={1}
              disabled={!isCommissioner}
            />
            <LabeledNumberField
              label="Anti-snipe (min)"
              value={form.antiSnipeMinutes}
              onChange={(value) => setForm((f) => ({ ...f, antiSnipeMinutes: value }))}
              min={0}
              disabled={!isCommissioner}
            />
          </View>

          <View style={styles.field}>
            <AppText variant="dimmed">Tiebreak rule</AppText>
            <View style={styles.chipRow}>
              {TIE_BREAK_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  active={form.tieBreakMode === opt.value}
                  disabled={!isCommissioner}
                  onPress={() => setForm((f) => ({ ...f, tieBreakMode: opt.value }))}
                />
              ))}
            </View>
          </View>

          <LabeledNumberField
            label="Drop-triggered bid window (hours)"
            value={form.dropCycleDurationHours}
            onChange={(value) => setForm((f) => ({ ...f, dropCycleDurationHours: value }))}
            min={1}
            disabled={!isCommissioner}
          />

          {!isCommissioner ? (
            <AppText variant="dimmed">Only the commissioner can change these settings.</AppText>
          ) : (
            <View style={styles.saveRow}>
              <Button title="Save" loading={saving} onPress={() => void handleSave()} />
              {saved && <AppText style={{ color: colors.primary }}>Saved.</AppText>}
            </View>
          )}
          {error && <AppText style={{ color: colors.danger }}>{error}</AppText>}
        </Card>

        {isCommissioner && (
          <Card style={styles.card}>
            <AppText variant="title" style={styles.cardTitle}>
              Invite team owners
            </AppText>
            <AppText variant="dimmed">
              Send each team&apos;s real owner their own link - anyone who redeems it can bid
              for that team.
            </AppText>
            {invites === undefined ? (
              <ActivityIndicator color={colors.primary} style={styles.invitesLoading} />
            ) : (
              <View style={styles.invitesList}>
                {invites.map((row) => (
                  <InviteRow
                    key={row.teamId}
                    row={row}
                    onGenerate={() =>
                      void createInvite({ seasonId, teamId: row.teamId as Id<'seasonTeams'> })
                    }
                    onRevoke={() =>
                      void revokeInvite({ seasonId, teamId: row.teamId as Id<'seasonTeams'> })
                    }
                    onRemoveMember={(userId) =>
                      void removeMember({
                        seasonId,
                        teamId: row.teamId as Id<'seasonTeams'>,
                        userId: userId as Id<'users'>,
                      })
                    }
                  />
                ))}
              </View>
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

function LabeledNumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <View style={styles.field}>
      <AppText variant="dimmed" numberOfLines={1}>
        {props.label}
      </AppText>
      <NumberField {...props} />
    </View>
  );
}

function InviteRow({
  row,
  onGenerate,
  onRevoke,
  onRemoveMember,
}: {
  row: TeamInviteRow;
  onGenerate: () => void;
  onRevoke: () => void;
  onRemoveMember: (userId: string) => void;
}) {
  const joinUrl = row.token ? `${JOIN_BASE_URL}/${row.token}` : null;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!joinUrl) return;
    const success = await copyToClipboard(joinUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card style={styles.inviteRow}>
      <View style={styles.inviteHeader}>
        <AppText numberOfLines={1} style={styles.inviteTeamName}>
          {row.teamName}
        </AppText>
        {joinUrl ? (
          <View style={styles.inviteActions}>
            <Pressable onPress={() => void handleCopy()} style={styles.smallButton}>
              <AppText style={styles.smallButtonText}>{copied ? 'Copied' : 'Copy link'}</AppText>
            </Pressable>
            <Pressable onPress={onRevoke} style={styles.smallButton}>
              <AppText style={[styles.smallButtonText, { color: colors.danger }]}>Revoke</AppText>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onGenerate} style={styles.smallButton}>
            <AppText style={styles.smallButtonText}>Generate link</AppText>
          </Pressable>
        )}
      </View>
      {joinUrl && (
        <AppText variant="dimmed" numberOfLines={2} style={styles.joinUrl}>
          {joinUrl}
        </AppText>
      )}
      {row.members.length > 0 && (
        <View style={styles.membersList}>
          {row.members.map((member) => (
            <View key={member.userId} style={styles.memberRow}>
              <AppText variant="dimmed" numberOfLines={1} style={styles.memberName}>
                {member.name ?? 'Unnamed user'}
              </AppText>
              <Pressable onPress={() => onRemoveMember(member.userId)}>
                <AppText style={styles.removeMemberText}>Remove</AppText>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    gap: 14,
  },
  cardTitle: {
    fontSize: 17,
  },
  field: {
    gap: 6,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 12,
  },
  saveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  invitesLoading: {
    marginVertical: 12,
  },
  invitesList: {
    gap: 8,
  },
  inviteRow: {
    gap: 6,
  },
  inviteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  inviteTeamName: {
    flex: 1,
    fontWeight: '500',
  },
  inviteActions: {
    flexDirection: 'row',
    gap: 8,
  },
  smallButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  smallButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  joinUrl: {
    fontSize: 12,
  },
  membersList: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    gap: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memberName: {
    flex: 1,
  },
  removeMemberText: {
    color: colors.danger,
    fontSize: 12,
  },
});
