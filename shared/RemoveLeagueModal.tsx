import { useState } from "react";
import { useMutation } from "convex/react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { getErrorMessage } from "./errors";

interface RemoveLeagueModalProps {
  // null = closed. Any season of the league works - deleteLeague removes the
  // whole league (every season in its history), not just this one.
  season: { _id: string; name: string } | null;
  onClose: () => void;
}

// infinileague/infinifaab's counterpart to infinidraft's Delete League
// button (pages/Settings/LeagueDetails.tsx) - same api.leagues.deleteLeague
// mutation, so connecting a league in any app can be undone from any app.
// One league row backs all three apps, which is why the copy below spells
// out that this isn't a per-app "hide".
export function RemoveLeagueModal({ season, onClose }: RemoveLeagueModalProps) {
  const deleteLeague = useMutation(api.leagues.deleteLeague);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (removing) return;
    setError(null);
    onClose();
  };

  const handleRemove = async () => {
    if (!season) return;
    setRemoving(true);
    setError(null);
    try {
      await deleteLeague({ id: season._id as Id<"seasons"> });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to remove league."));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Modal opened={season !== null} onClose={handleClose} title="Remove league">
      <Stack gap="md">
        <Text size="sm">
          This removes <b>{season?.name}</b> and every season of its history
          from infinidraft, infinileague, and infinifaab - including draft
          results, keepers, and auction history. This cannot be undone.
        </Text>
        <Text size="sm" c="dimmed">
          You can connect the league again later, but anything that only
          lived here won't come back.
        </Text>
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose} disabled={removing}>
            Cancel
          </Button>
          <Button color="red" loading={removing} onClick={() => void handleRemove()}>
            Remove League
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
