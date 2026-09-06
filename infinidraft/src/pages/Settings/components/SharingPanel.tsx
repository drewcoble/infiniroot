import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Button,
  Card,
  Center,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Check, Copy } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { getErrorMessage } from "@shared/errors";
import { copyToClipboard } from "../../../lib/clipboard";

interface SharingPanelProps {
  seasonId: Id<"seasons">;
}

// "Invite a co-manager" - infinidraft's first pass at multi-user access,
// modeled after infinifaab's per-team invite flow (see convex/schema.ts's
// leagueInvites/leagueCollaborators comments) but scoped to the whole
// league: anyone who redeems the link can view/edit this league exactly as
// the owner can (requireSeasonOwner treats them identically), rather than
// being scoped to a single team's bids. Self-contained (owns its own
// queries/mutations) rather than threaded through LeagueDetails' already
// large prop list, same pattern as PickSlotsPanel.
export function SharingPanel({ seasonId }: SharingPanelProps) {
  const sharing = useQuery(api.infinidraft.sharing.invites.getLeagueSharing, {
    seasonId,
  });
  const createInvite = useMutation(
    api.infinidraft.sharing.invites.createLeagueInvite,
  );
  const revokeInvite = useMutation(
    api.infinidraft.sharing.invites.revokeLeagueInvite,
  );
  const removeCollaborator = useMutation(
    api.infinidraft.sharing.invites.removeCollaborator,
  );

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinUrl = sharing?.token
    ? `${window.location.origin}/join/${sharing.token}`
    : null;

  const handleCopy = async () => {
    if (!joinUrl) return;
    const success = await copyToClipboard(joinUrl);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const runAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong."));
    }
  };

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Title order={5}>Sharing</Title>
        <Text size="sm" c="dimmed">
          Invite a co-manager to help run this league - anyone who redeems
          the link can view and edit anything in this league, same as you.
        </Text>
        {sharing === undefined ? (
          <Center py="md">
            <Loader size="sm" />
          </Center>
        ) : (
          <Stack gap={8}>
            {joinUrl ? (
              <Stack gap={6}>
                <Group gap={6} wrap="nowrap">
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={() => void handleCopy()}
                  >
                    {copied ? "Copied" : "Copy invite link"}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => void runAction(() => revokeInvite({ seasonId }))}
                  >
                    Revoke
                  </Button>
                </Group>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ userSelect: "all", wordBreak: "break-all" }}
                >
                  {joinUrl}
                </Text>
              </Stack>
            ) : (
              <Button
                size="xs"
                variant="light"
                w="fit-content"
                onClick={() =>
                  void runAction(() => createInvite({ seasonId }))
                }
              >
                Generate invite link
              </Button>
            )}
            {error && (
              <Text size="sm" c="red">
                {error}
              </Text>
            )}
            {sharing.collaborators.length > 0 && (
              <>
                <Divider label="Co-managers" labelPosition="left" />
                {sharing.collaborators.map((collaborator) => (
                  <Group
                    key={collaborator._id}
                    justify="space-between"
                    wrap="nowrap"
                  >
                    <Text size="sm" c="dimmed" truncate>
                      {collaborator.name ?? collaborator.email ?? "Unnamed user"}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      color="red"
                      onClick={() =>
                        void runAction(() =>
                          removeCollaborator({
                            seasonId,
                            collaboratorId: collaborator._id,
                          }),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </Group>
                ))}
              </>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
