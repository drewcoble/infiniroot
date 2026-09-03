import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Badge,
  Box,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { getErrorMessage } from "@shared/errors";

interface PickSlotsPanelProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
  maxRounds: number;
  // Trading/forfeiting a slot is locked to pre-draft, same as draft order
  // (convex/draft/pickSlots.ts's requireDraftNotStarted) - changing who owns
  // an already-picked round retroactively would make that round's recorded
  // picks wrong. The table itself (who owns what) stays visible either way.
  isDraftStarted: boolean;
}

// Editor for SNAKE_DRAFT.md §9's traded/forfeited picks - only ever shows
// slots someone has actually touched (convex/draft/pickSlots.ts's "invisible
// until touched" convention), plus a form to touch a new one. Every slot not
// listed here is still owned by its original team, untouched.
export function PickSlotsPanel({
  seasonId,
  teams,
  maxRounds,
  isDraftStarted,
}: PickSlotsPanelProps) {
  const slots = useQuery(api.infinidraft.draft.pickSlots.listPickSlots, { seasonId });
  const tradePickSlot = useMutation(api.infinidraft.draft.pickSlots.tradePickSlot);
  const forfeitPickSlot = useMutation(api.infinidraft.draft.pickSlots.forfeitPickSlot);
  const restorePickSlot = useMutation(api.infinidraft.draft.pickSlots.restorePickSlot);

  const teamById = useMemo(
    () => new Map(teams.map((t) => [t._id, t])),
    [teams],
  );
  const teamOptions = useMemo(
    () => teams.map((t) => ({ value: t._id, label: t.name })),
    [teams],
  );

  const [round, setRound] = useState(1);
  const [originalTeamId, setOriginalTeamId] =
    useState<Id<"seasonTeams"> | null>(null);
  const [action, setAction] = useState<"trade" | "forfeit">("trade");
  const [newTeamId, setNewTeamId] = useState<Id<"seasonTeams"> | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<Id<"draftPickSlots"> | null>(
    null,
  );

  const handleSubmit = async () => {
    if (!originalTeamId) return;
    if (action === "trade" && !newTeamId) return;
    setError(null);
    setIsSaving(true);
    try {
      if (action === "trade") {
        await tradePickSlot({
          seasonId,
          round,
          originalTeamId,
          newTeamId: newTeamId!,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      } else {
        await forfeitPickSlot({
          seasonId,
          round,
          originalTeamId,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      setOriginalTeamId(null);
      setNewTeamId(null);
      setNote("");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = async (slot: Doc<"draftPickSlots">) => {
    setError(null);
    setRestoringId(slot._id);
    try {
      await restorePickSlot({
        seasonId,
        round: slot.round,
        originalTeamId: slot.originalTeamId,
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to restore this slot."));
    } finally {
      setRestoringId(null);
    }
  };

  if (teams.length === 0 || maxRounds < 1) return null;

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Text size="md" fw={500}>
          Traded &amp; Forfeited Picks
        </Text>
        <Text size="xs" c="dimmed">
          Reassign or forfeit one team's slot in a specific round - every
          other slot stays with its original owner.
        </Text>

        {slots === undefined || slots.length === 0 ? (
          <Text size="xs" c="dimmed">
            No trades or forfeits recorded yet.
          </Text>
        ) : (
          <Box style={{ overflowX: "auto" }}>
            <Table verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Round</Table.Th>
                  <Table.Th>Original team</Table.Th>
                  <Table.Th>Now</Table.Th>
                  <Table.Th>Note</Table.Th>
                  {!isDraftStarted && <Table.Th />}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {slots.map((slot) => (
                  <Table.Tr key={slot._id}>
                    <Table.Td>{slot.round}</Table.Td>
                    <Table.Td>
                      {teamById.get(slot.originalTeamId)?.name ?? "Unknown"}
                    </Table.Td>
                    <Table.Td>
                      {slot.currentTeamId === null ? (
                        <Badge color="red" variant="light">
                          Forfeited
                        </Badge>
                      ) : (
                        (teamById.get(slot.currentTeamId)?.name ?? "Unknown")
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {slot.note ?? ""}
                      </Text>
                    </Table.Td>
                    {!isDraftStarted && (
                      <Table.Td>
                        <Button
                          size="xs"
                          variant="subtle"
                          loading={restoringId === slot._id}
                          onClick={() => handleRestore(slot)}
                        >
                          Restore
                        </Button>
                      </Table.Td>
                    )}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Box>
        )}

        {!isDraftStarted && (
          <Stack gap="xs">
            <Group gap="sm" wrap="wrap" align="flex-end">
              <NumberInput
                label="Round"
                min={1}
                max={maxRounds}
                w={90}
                size="sm"
                value={round}
                onChange={(v) => setRound(Number(v) || 1)}
              />
              <Select
                label="Original team"
                placeholder="Select team"
                data={teamOptions}
                value={originalTeamId}
                onChange={(v) =>
                  setOriginalTeamId(v as Id<"seasonTeams"> | null)
                }
                w={180}
                size="sm"
              />
              <Select
                label="Action"
                data={[
                  { value: "trade", label: "Trade to..." },
                  { value: "forfeit", label: "Forfeit" },
                ]}
                value={action}
                onChange={(v) => setAction((v as "trade" | "forfeit") ?? "trade")}
                allowDeselect={false}
                w={140}
                size="sm"
              />
              {action === "trade" && (
                <Select
                  label="New team"
                  placeholder="Select team"
                  data={teamOptions}
                  value={newTeamId}
                  onChange={(v) => setNewTeamId(v as Id<"seasonTeams"> | null)}
                  w={180}
                  size="sm"
                />
              )}
              <TextInput
                label="Note (optional)"
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
                w={200}
                size="sm"
              />
            </Group>
            {error && (
              <Text c="red" size="sm">
                {error}
              </Text>
            )}
            <Button
              size="sm"
              w="fit-content"
              loading={isSaving}
              disabled={
                !originalTeamId || (action === "trade" && !newTeamId)
              }
              onClick={handleSubmit}
            >
              Save
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
