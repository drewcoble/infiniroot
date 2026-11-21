import { useState } from "react";
import type { GenericId as Id } from "convex/values";
import { Button, Card, Center, Divider, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { useCreateTeamInvite } from "@shared-core/useCreateTeamInvite";
import { useRemoveTeamMember } from "@shared-core/useRemoveTeamMember";
import { useRevokeTeamInvite } from "@shared-core/useRevokeTeamInvite";
import { useTeamInvites, type TeamInviteRow } from "@shared-core/useTeamInvites";
import { copyToClipboard } from "../lib/clipboard";

// The commissioner's per-team invite links - the same leagueTeamInvites
// infinifaab hands out, so a member who joined there is already in here
// (and a link from here gets them into infinifaab too).
export function TeamInvitesCard({ seasonId }: { seasonId: Id<"seasons"> }) {
  const invites = useTeamInvites(seasonId, true);
  const createInvite = useCreateTeamInvite();
  const revokeInvite = useRevokeTeamInvite();
  const removeMember = useRemoveTeamMember();

  return (
    <Card padding="md" radius="md">
      <Stack gap="sm">
        <Title order={5}>Invite league members</Title>
        <Text size="sm" c="dimmed">
          One link per team - also works in infinifaab.
        </Text>
        {invites === undefined ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : (
          <Stack gap={8}>
            {invites.map((row) => {
              const teamId = row.teamId as Id<"seasonTeams">;
              return (
                <InviteRow
                  key={row.teamId}
                  row={row}
                  onGenerate={() => void createInvite({ seasonId, teamId })}
                  onRevoke={() => void revokeInvite({ seasonId, teamId })}
                  onRemoveMember={(userId) =>
                    void removeMember({ seasonId, teamId, userId: userId as Id<"users"> })
                  }
                />
              );
            })}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

interface InviteRowProps {
  row: TeamInviteRow;
  onGenerate: () => void;
  onRevoke: () => void;
  onRemoveMember: (userId: string) => void;
}

function InviteRow({ row, onGenerate, onRevoke, onRemoveMember }: InviteRowProps) {
  const joinUrl = row.token ? `${window.location.origin}/join/${row.token}` : null;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!joinUrl) return;
    if (await copyToClipboard(joinUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Card padding="xs" radius="md">
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
