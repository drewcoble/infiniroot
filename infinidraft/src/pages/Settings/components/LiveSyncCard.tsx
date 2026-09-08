import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";

// Shared presentational shape for both providers' "Live sync from X" cards
// in LeagueDetails.tsx - extracted from what used to be Sleeper's own inline
// Card (see git history) once Yahoo needed an identical second instance.
// Both providers read the same underlying draftSyncStatus row (see convex/
// infinidraft/draft/draftSyncShared.ts's getSyncStatus - a draft only ever
// has one provider actively syncing at a time), so LeagueDetails.tsx passes
// the same syncStatus query result into whichever card is currently
// "enabled"; this component itself has no opinion on which provider it is.
export interface LiveSyncCardProps {
  title: string;
  enableButtonLabel: string;
  description: string;
  // Pre-formatted "Scheduled for X" text, or undefined to omit that line
  // entirely - only Sleeper's poller caches a scheduled start time today
  // (see schema.ts's drafts.yahooSyncEnabled comment for why Yahoo's
  // doesn't).
  scheduledAtText?: string | undefined;
  enabled: boolean;
  syncError: string | null | undefined;
  lastSyncedAt: number | null | undefined;
  canEnable: boolean;
  enabling: boolean;
  onEnable: () => void;
  onDisable: () => void;
  // Local (client-only) success/error text from the enable/disable click
  // itself, separate from syncError above (which is the poll chain's own
  // ongoing status) - localError takes priority when both are present, same
  // as the original inline card.
  localStatus: string | null;
  localError: string | null;
}

export function LiveSyncCard({
  title,
  enableButtonLabel,
  description,
  scheduledAtText,
  enabled,
  syncError,
  lastSyncedAt,
  canEnable,
  enabling,
  onEnable,
  onDisable,
  localStatus,
  localError,
}: LiveSyncCardProps) {
  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={500}>{title}</Text>
          {enabled && (
            <Badge variant="light" color={syncError ? "yellow" : "teal"}>
              {syncError ? "Sync issue" : "Live"}
            </Badge>
          )}
        </Group>
        {scheduledAtText && (
          <Text size="sm">
            Scheduled for{" "}
            <Text component="span" fw={600}>
              {scheduledAtText}
            </Text>
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {description}
        </Text>
        {enabled ? (
          <>
            <Text size="sm">
              {lastSyncedAt
                ? `Last checked ${new Date(lastSyncedAt).toLocaleTimeString()}`
                : "Starting up..."}
            </Text>
            <Button variant="default" color="red" onClick={onDisable} w="fit-content">
              Disable Live Sync
            </Button>
          </>
        ) : (
          <Button
            onClick={onEnable}
            loading={enabling}
            disabled={!canEnable}
            w="fit-content"
          >
            {enableButtonLabel}
          </Button>
        )}
        {localStatus && (
          <Text size="xs" c="teal">
            {localStatus}
          </Text>
        )}
        {(syncError || localError) && (
          <Text size="xs" c={localError ? "red" : "yellow.7"}>
            {localError ?? syncError}
          </Text>
        )}
      </Stack>
    </Card>
  );
}
