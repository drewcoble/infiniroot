import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { api } from "@infinidata/api";
import { EditableNumberStepper } from "@shared/NumberStepper";
import { getErrorMessage } from "@shared/errors";
import { copyToClipboard } from "../../../lib/clipboard";
import type { AuctionSettings, MyParticipation, TeamInviteRow } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/settings")({
  component: SettingsTab,
});

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const TIE_BREAK_OPTIONS = [
  { value: "earliest", label: "Earliest bid wins" },
  { value: "waiverOrder", label: "Waiver order wins" },
];

function SettingsTab() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const participation: MyParticipation | undefined = useQuery(
    api.infinileague.auction.participant.getMyParticipation,
    isAuthenticated ? { seasonId } : "skip",
  );
  const settings: AuctionSettings | undefined = useQuery(
    api.infinileague.auction.settings.getAuctionSettings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const isCommissioner = participation?.isCommissioner ?? false;
  const invites: TeamInviteRow[] | undefined = useQuery(
    api.infinileague.auction.invites.listTeamInvites,
    isAuthenticated && isCommissioner ? { seasonId } : "skip",
  );

  const updateSettings = useMutation(api.infinileague.auction.settings.updateAuctionSettings);
  const createInvite = useMutation(api.infinileague.auction.invites.createTeamInvite);
  const revokeInvite = useMutation(api.infinileague.auction.invites.revokeTeamInvite);
  const removeMember = useMutation(api.infinileague.auction.invites.removeTeamMember);

  const [form, setForm] = useState<AuctionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings && !form) setForm(settings);
  }, [settings, form]);

  if (participation === undefined || settings === undefined || !form) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // No timeZone field - the auction schedule always runs on Eastern
      // Time now, not a per-league setting (see convex/infinileague/
      // auction/settings.ts's AUCTION_TIME_ZONE) - spreading the whole
      // `form` object here would fail Convex's arg validation, since that
      // field no longer exists on updateAuctionSettings at all.
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
      });
      setSaved(true);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save settings."));
    } finally {
      setSaving(false);
    }
  };

  // closeHour is stored/interpreted as 24h Eastern time throughout the
  // backend (convex/lib/timezone.ts's nextWeeklyOccurrence) - this form
  // only converts to/from a 12h + AM/PM display, same convention any real
  // clock picker uses. 0 and 12 (24h) both display as "12" (12 AM/12 PM).
  const hour12 = form.closeHour % 12 === 0 ? 12 : form.closeHour % 12;
  const isPM = form.closeHour >= 12;

  const handleHour12Change = (value: number | undefined) => {
    if (value === undefined) return;
    const clamped = Math.min(12, Math.max(1, value));
    setForm({ ...form, closeHour: (clamped % 12) + (isPM ? 12 : 0) });
  };

  const handleAmPmChange = (value: string) => {
    const pm = value === "PM";
    setForm({ ...form, closeHour: (hour12 % 12) + (pm ? 12 : 0) });
  };

  return (
    <Stack gap="lg">
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Title order={5}>Auction schedule</Title>
          <Switch
            label="Auction enabled"
            checked={form.enabled}
            disabled={!isCommissioner}
            onChange={(e) => setForm({ ...form, enabled: e.currentTarget.checked })}
          />
          <Select
            label="Closes on"
            data={WEEKDAY_OPTIONS}
            value={String(form.closeWeekday)}
            disabled={!isCommissioner}
            onChange={(value) =>
              value && setForm({ ...form, closeWeekday: Number(value) })
            }
          />
          <Group align="flex-end">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Hour
              </Text>
              <EditableNumberStepper
                value={hour12}
                onChange={handleHour12Change}
                min={1}
                max={12}
                step={1}
                width={80}
                label="hour"
                disabled={!isCommissioner}
              />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Minute
              </Text>
              <EditableNumberStepper
                value={form.closeMinute}
                onChange={(value) =>
                  value !== undefined && setForm({ ...form, closeMinute: value })
                }
                min={0}
                max={55}
                step={5}
                width={80}
                label="minute"
                disabled={!isCommissioner}
              />
            </Stack>
            <SegmentedControl
              data={["AM", "PM"]}
              value={isPM ? "PM" : "AM"}
              onChange={handleAmPmChange}
              disabled={!isCommissioner}
            />
          </Group>
          <Text size="sm" c="dimmed">
            Times are in Eastern Time (ET).
          </Text>
          <Group align="flex-end">
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Starting bid ($)
              </Text>
              <EditableNumberStepper
                value={form.startingBid}
                onChange={(value) =>
                  value !== undefined && setForm({ ...form, startingBid: value })
                }
                min={0}
                width={90}
                label="starting bid"
                disabled={!isCommissioner}
              />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Minimum increment ($)
              </Text>
              <EditableNumberStepper
                value={form.minIncrement}
                onChange={(value) =>
                  value !== undefined && setForm({ ...form, minIncrement: value })
                }
                min={1}
                width={90}
                label="minimum increment"
                disabled={!isCommissioner}
              />
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Anti-snipe extension (min)
              </Text>
              <EditableNumberStepper
                value={form.antiSnipeMinutes}
                onChange={(value) =>
                  value !== undefined && setForm({ ...form, antiSnipeMinutes: value })
                }
                min={0}
                width={90}
                label="anti-snipe extension"
                disabled={!isCommissioner}
              />
            </Stack>
          </Group>
          <Select
            label="Tiebreak rule"
            description="Which bidder wins when two teams bid the exact same max"
            data={TIE_BREAK_OPTIONS}
            value={form.tieBreakMode}
            disabled={!isCommissioner}
            onChange={(value) =>
              (value === "earliest" || value === "waiverOrder") &&
              setForm({ ...form, tieBreakMode: value })
            }
          />
          {!isCommissioner && (
            <Text size="sm" c="dimmed">
              Only the commissioner can change these settings.
            </Text>
          )}
          {isCommissioner && (
            <Group>
              <Button onClick={() => void handleSave()} loading={saving}>
                Save
              </Button>
              {saved && (
                <Text size="sm" c="green">
                  Saved.
                </Text>
              )}
            </Group>
          )}
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
        </Stack>
      </Card>

      {isCommissioner && (
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Title order={5}>Invite team owners</Title>
            <Text size="sm" c="dimmed">
              Send each team's real owner their own link - anyone who redeems it
              can bid for that team.
            </Text>
            {invites === undefined ? (
              <Center py="md">
                <Loader size="sm" />
              </Center>
            ) : (
              <Stack gap={8}>
                {invites.map((row) => (
                  <InviteRow
                    key={row.teamId}
                    row={row}
                    seasonId={seasonId}
                    onGenerate={() => void createInvite({ seasonId, teamId: row.teamId as Id<"seasonTeams"> })}
                    onRevoke={() => void revokeInvite({ seasonId, teamId: row.teamId as Id<"seasonTeams"> })}
                    onRemoveMember={(userId) =>
                      void removeMember({
                        seasonId,
                        teamId: row.teamId as Id<"seasonTeams">,
                        userId: userId as Id<"users">,
                      })
                    }
                  />
                ))}
              </Stack>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

interface InviteRowProps {
  row: TeamInviteRow;
  seasonId: Id<"seasons">;
  onGenerate: () => void;
  onRevoke: () => void;
  onRemoveMember: (userId: string) => void;
}

function InviteRow({ row, onGenerate, onRevoke, onRemoveMember }: InviteRowProps) {
  const joinUrl = row.token ? `${window.location.origin}/join/${row.token}` : null;
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
    <Card withBorder padding="xs" radius="md">
      <Stack gap={6}>
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500} truncate>
            {row.teamName}
          </Text>
          {joinUrl ? (
            <Group gap={6} wrap="nowrap">
              <Button
                size="xs"
                variant="light"
                leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
                onClick={() => void handleCopy()}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
              <Button size="xs" variant="subtle" color="red" onClick={onRevoke}>
                Revoke
              </Button>
            </Group>
          ) : (
            <Button size="xs" variant="light" onClick={onGenerate}>
              Generate link
            </Button>
          )}
        </Group>
        {joinUrl && (
          <Text
            size="xs"
            c="dimmed"
            style={{ userSelect: "all", wordBreak: "break-all" }}
          >
            {joinUrl}
          </Text>
        )}
        {row.members.length > 0 && (
          <>
            <Divider />
            {row.members.map((member) => (
              <Group key={member.userId} justify="space-between" wrap="nowrap">
                <Text size="xs" c="dimmed" truncate>
                  {member.name ?? "Unnamed user"}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  onClick={() => onRemoveMember(member.userId)}
                >
                  Remove
                </Button>
              </Group>
            ))}
          </>
        )}
      </Stack>
    </Card>
  );
}
