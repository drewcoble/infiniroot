import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Chip,
  Group,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  Check,
  GripVertical,
  MoreVertical,
  Pencil,
  Shuffle,
  Trash2,
  UserPlus,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { api } from "@infinidata/api";
import type { Doc, Id } from "@infinidata/dataModel";
import { TeamOrderRow } from "./TeamOrderRow";
import { getErrorMessage } from "@shared/errors";

interface TeamsPanelProps {
  seasonId: Id<"seasons">;
  teams: Doc<"seasonTeams">[];
  nominationOrder: Id<"seasonTeams">[] | undefined;
  nominationOrderMode: "linear" | "snake" | undefined;
  salaryCap: number;
  onRenameTeam: (teamId: Id<"seasonTeams">, name: string) => void;
  onSetTeamSalaryCap: (
    teamId: Id<"seasonTeams">,
    salaryCap: number | null,
  ) => void;
  onAddTeam: (name: string) => Promise<void> | void;
  onRemoveTeam: (teamId: Id<"seasonTeams">) => Promise<void> | void;
  renameError: string | null;
  // True once the draft has started (convex/draft/teams.ts's
  // addSeasonTeam/removeSeasonTeam reject it server-side too) - renaming,
  // salary cap overrides, and nomination-order reordering all stay
  // available regardless, only add/remove lock.
  addLocked?: boolean;
  removeLocked?: boolean;
  // True for a snake/linear season (SNAKE_DRAFT.md §3.1/§5) - swaps the
  // order this panel edits from drafts.nominationOrder (auction's soft
  // suggestion) to drafts.draftOrder (the real, authoritative pick order),
  // hides the Linear/Snake mode toggle (the bounce is already implied by
  // the league's draftType, not independently choosable here), and hides
  // salary-cap editing entirely (not applicable outside auction).
  isSnakeOrLinear?: boolean;
  draftOrder?: Id<"seasonTeams">[] | undefined;
  // 3rd-round-reversal & friends (SNAKE_DRAFT.md §10) - which round
  // boundaries repeat the previous round's direction instead of the usual
  // bounce-and-flip. Only rendered/editable for a snake/linear league;
  // maxRounds bounds the picker to this league's actual roster length (no
  // point offering a reversal round past the last one that'll ever exist).
  reversalRounds?: number[] | undefined;
  maxRounds?: number;
}

// One consolidated list for every "teams already exist" concern - renaming
// and nomination-order reordering both just operate on the same list of
// teams, so they used to live in two separate cards (Draft Teams /
// Nomination Order) that each rendered their own copy of the team list.
// Order here (see convex/draft/nominationOrder.ts) is always just a
// *suggestion* the Draft Room's nominate form defaults to, never an
// enforced restriction - the host can still nominate as any team, or clear
// "whose turn" to none at all (e.g. for a pre-cycle top-X auction), at any
// time.
export function TeamsPanel({
  seasonId,
  teams,
  nominationOrder,
  nominationOrderMode,
  salaryCap,
  onRenameTeam,
  onSetTeamSalaryCap,
  onAddTeam,
  onRemoveTeam,
  renameError,
  addLocked = false,
  removeLocked = false,
  isSnakeOrLinear = false,
  draftOrder,
  reversalRounds,
  maxRounds = 0,
}: TeamsPanelProps) {
  const teamById = useMemo(() => {
    const map = new Map<string, Doc<"seasonTeams">>();
    for (const team of teams) map.set(team._id, team);
    return map;
  }, [teams]);

  const defaultOrder = useMemo(
    () => [...teams].sort((a, b) => a.order - b.order).map((t) => t._id),
    [teams],
  );

  // Whichever order this season actually uses - drafts.draftOrder for
  // snake/linear, drafts.nominationOrder for auction (see isSnakeOrLinear's
  // comment on the props interface).
  const activeOrder = isSnakeOrLinear ? draftOrder : nominationOrder;

  const [localOrder, setLocalOrder] = useState<Id<"seasonTeams">[]>(
    activeOrder ?? defaultOrder,
  );
  const [mode, setMode] = useState<"linear" | "snake">(
    nominationOrderMode ?? "linear",
  );
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingCaps, setEditingCaps] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [removingMode, setRemovingMode] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] =
    useState<Id<"seasonTeams"> | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [addingTeam, setAddingTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [reversalDraft, setReversalDraft] = useState<number[]>(
    reversalRounds ?? [],
  );
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [isSavingReversal, setIsSavingReversal] = useState(false);

  // Distance constraint so tapping the grip handle to just view/scroll
  // doesn't immediately start a drag - same reasoning as elsewhere in this
  // panel about not letting a stray touch quietly change something.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    setLocalOrder(activeOrder ?? defaultOrder);
    // activeOrder is derived fresh from draftOrder/nominationOrder each
    // render (not itself a stable dep) - depend on the two underlying props
    // instead so this doesn't re-run every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nominationOrder, draftOrder, defaultOrder]);

  useEffect(() => {
    setMode(nominationOrderMode ?? "linear");
  }, [nominationOrderMode]);

  useEffect(() => {
    setReversalDraft(reversalRounds ?? []);
    // Same "resync only when the actual prop changes" reasoning as the
    // order effect above - reversalRounds isn't a stable reference across
    // renders, but its own array of numbers is what should trigger a reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(reversalRounds ?? []).join(",")]);

  const setNominationOrder = useMutation(
    api.infinidraft.draft.nominationOrder.setNominationOrder,
  );
  const clearNominationOrder = useMutation(
    api.infinidraft.draft.nominationOrder.clearNominationOrder,
  );
  const setDraftOrder = useMutation(api.infinidraft.draft.draftOrder.setDraftOrder);
  const clearDraftOrder = useMutation(api.infinidraft.draft.draftOrder.clearDraftOrder);
  const setReversalRoundsMutation = useMutation(
    api.infinidraft.draft.draftOrder.setReversalRounds,
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setLocalOrder((current) => {
      const oldIndex = current.indexOf(active.id as Id<"seasonTeams">);
      const newIndex = current.indexOf(over.id as Id<"seasonTeams">);
      if (oldIndex === -1 || newIndex === -1) return current;
      return arrayMove(current, oldIndex, newIndex);
    });
  };

  // Fisher-Yates - only touches local state, same as a drag reorder, so it
  // still goes through the existing Save Order flow rather than writing
  // straight to the server (keeps "randomize, look it over, then commit or
  // discard" possible instead of instantly locking in a shuffle).
  const randomize = () => {
    const next = [...localOrder];
    for (let i = next.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [next[i], next[j]] = [next[j]!, next[i]!];
    }
    setLocalOrder(next);
  };

  const handleSave = async () => {
    setOrderError(null);
    setIsSaving(true);
    try {
      if (isSnakeOrLinear) {
        await setDraftOrder({ seasonId, teamIds: localOrder });
      } else {
        await setNominationOrder({ seasonId, teamIds: localOrder, mode });
      }
    } catch (err) {
      setOrderError(getErrorMessage(err, "Failed to save order."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    setOrderError(null);
    try {
      if (isSnakeOrLinear) {
        await clearDraftOrder({ seasonId });
      } else {
        await clearNominationOrder({ seasonId });
      }
    } catch (err) {
      setOrderError(getErrorMessage(err, "Failed to clear order."));
    }
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemoveId) return;
    setIsRemoving(true);
    try {
      await onRemoveTeam(pendingRemoveId);
      setPendingRemoveId(null);
    } finally {
      setIsRemoving(false);
    }
  };

  const handleConfirmAdd = async () => {
    const name = newTeamName.trim();
    if (!name) return;
    setAddError(null);
    setIsAdding(true);
    try {
      await onAddTeam(name);
      setNewTeamName("");
      setAddingTeam(false);
    } catch (err) {
      setAddError(getErrorMessage(err, "Failed to add team."));
    } finally {
      setIsAdding(false);
    }
  };

  // No order active yet is always "dirty" - Save should be clickable even
  // when localOrder (seeded from defaultOrder) happens to already match
  // what team-creation order would produce, since clicking Save is still a
  // real state change (inactive -> active) rather than a no-op. Once an
  // order IS active, only an actual difference from it makes this dirty.
  // Mode never factors in for snake/linear - the bounce is fixed by the
  // league's draftType, not independently editable here (see
  // isSnakeOrLinear's comment on the props interface).
  const isDirty =
    !activeOrder ||
    localOrder.join(",") !== activeOrder.join(",") ||
    (!isSnakeOrLinear && mode !== (nominationOrderMode ?? "linear"));

  const handleSaveReversalRounds = async () => {
    setReversalError(null);
    setIsSavingReversal(true);
    try {
      await setReversalRoundsMutation({
        seasonId,
        reversalRounds: reversalDraft,
      });
    } catch (err) {
      setReversalError(
        getErrorMessage(err, "Failed to save reversal rounds."),
      );
    } finally {
      setIsSavingReversal(false);
    }
  };

  const isReversalDirty =
    [...reversalDraft].sort((a, b) => a - b).join(",") !==
    [...(reversalRounds ?? [])].sort((a, b) => a - b).join(",");

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text size="md" fw={500}>
          {isSnakeOrLinear ? "Draft Order" : "Teams"}
        </Text>
        <Group gap="xs">
          {!isSnakeOrLinear && (
            <SegmentedControl
              size="sm"
              value={mode}
              onChange={(value) => setMode(value as "linear" | "snake")}
              data={[
                { label: "Linear", value: "linear" },
                { label: "Snake", value: "snake" },
              ]}
            />
          )}
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="default" size={40} aria-label="Team actions">
                <MoreVertical size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {!isSnakeOrLinear && (
                <Menu.Item
                  leftSection={<Pencil size={14} />}
                  rightSection={editingCaps ? <Check size={14} /> : undefined}
                  onClick={() => setEditingCaps((current) => !current)}
                >
                  Edit Caps
                </Menu.Item>
              )}
              <Menu.Item
                leftSection={<GripVertical size={14} />}
                rightSection={reordering ? <Check size={14} /> : undefined}
                onClick={() => setReordering((current) => !current)}
              >
                Reorder
              </Menu.Item>
              <Menu.Item
                leftSection={<Shuffle size={14} />}
                onClick={randomize}
              >
                Randomize
              </Menu.Item>
              <Menu.Item
                leftSection={<UserPlus size={14} />}
                onClick={() => setAddingTeam(true)}
                disabled={addLocked}
              >
                {addLocked ? "Add Team (locked)" : "Add Team"}
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<Trash2 size={14} />}
                rightSection={removingMode ? <Check size={14} /> : undefined}
                onClick={() => setRemovingMode((current) => !current)}
                disabled={removeLocked}
              >
                {removeLocked ? "Remove Teams (locked)" : "Remove Teams"}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {renameError && (
        <Text c="red" size="sm">
          {renameError}
        </Text>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={localOrder}
          strategy={verticalListSortingStrategy}
        >
          {/* Each row's controls (name field, salary cap stepper, drag
              handle, remove button - especially with Edit Caps on) add up
              to wider than a phone screen. overflowX lets that overflow be
              reached by scrolling instead of just clipping off-screen with
              no way back to it; miw on the Stack keeps rows at their
              natural width instead of getting squished to fit. */}
          <Box style={{ overflowX: "auto" }}>
            <Stack gap={4} miw="max-content">
              {localOrder.map((teamId, index) => {
                const team = teamById.get(teamId);
                if (!team) return null;
                return (
                  <TeamOrderRow
                    key={teamId}
                    team={team}
                    index={index}
                    salaryCap={salaryCap}
                    editingCaps={editingCaps}
                    reordering={reordering}
                    removing={removingMode}
                    onRename={(name) => onRenameTeam(team._id, name)}
                    onSetSalaryCap={(cap) => onSetTeamSalaryCap(team._id, cap)}
                    onRequestRemove={() => setPendingRemoveId(team._id)}
                    showSalaryCap={!isSnakeOrLinear}
                  />
                );
              })}
            </Stack>
          </Box>
        </SortableContext>
      </DndContext>
      {orderError && (
        <Text c="red" size="sm">
          {orderError}
        </Text>
      )}
      <Group gap="xs">
        <Button
          size="md"
          onClick={handleSave}
          loading={isSaving}
          disabled={!isDirty}
        >
          Save Order
        </Button>
        {activeOrder && (
          <Button size="md" variant="default" onClick={handleClear}>
            {isSnakeOrLinear ? "Clear order" : "Clear (fully manual)"}
          </Button>
        )}
        <Badge variant="light" color={isDirty ? "yellow" : "teal"}>
          {isDirty ? "Unsaved changes" : "All changes saved"}
        </Badge>
        {activeOrder && (
          <Badge variant="light" color="teal">
            Order active
          </Badge>
        )}
      </Group>

      {isSnakeOrLinear && maxRounds >= 2 && (
        <Stack gap={6} mt="sm">
          <Text size="sm" fw={500}>
            Reversal rounds
          </Text>
          <Text size="xs" c="dimmed">
            A picked round repeats the previous round's order instead of
            alternating - e.g. 3rd-round reversal keeps rounds 2 and 3 in the
            same order back to back.
          </Text>
          <Chip.Group
            multiple
            value={reversalDraft.map(String)}
            onChange={(values) =>
              setReversalDraft((values as string[]).map(Number))
            }
          >
            <Group gap="xs" wrap="wrap">
              {Array.from({ length: maxRounds - 1 }, (_, i) => i + 2).map(
                (round) => (
                  <Chip key={round} value={String(round)}>
                    Round {round}
                  </Chip>
                ),
              )}
            </Group>
          </Chip.Group>
          {reversalError && (
            <Text c="red" size="sm">
              {reversalError}
            </Text>
          )}
          <Group gap="xs">
            <Button
              size="sm"
              onClick={handleSaveReversalRounds}
              loading={isSavingReversal}
              disabled={!isReversalDirty}
            >
              Save Reversal Rounds
            </Button>
            <Badge variant="light" color={isReversalDirty ? "yellow" : "teal"}>
              {isReversalDirty ? "Unsaved changes" : "All changes saved"}
            </Badge>
          </Group>
        </Stack>
      )}

      <Modal
        opened={pendingRemoveId !== null}
        onClose={() => setPendingRemoveId(null)}
        title="Remove team"
      >
        <Stack gap="md">
          <Text size="sm">
            Remove {teamById.get(pendingRemoveId ?? "")?.name ?? "this team"}{" "}
            from this league? This can't be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingRemoveId(null)}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={isRemoving}
              onClick={handleConfirmRemove}
            >
              Remove Team
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={addingTeam}
        onClose={() => {
          setAddingTeam(false);
          setNewTeamName("");
          setAddError(null);
        }}
        title="Add team"
      >
        <Stack gap="md">
          <TextInput
            label="Team name"
            placeholder="Team name"
            value={newTeamName}
            onChange={(event) => setNewTeamName(event.currentTarget.value)}
            data-autofocus
          />
          {addError && (
            <Text c="red" size="sm">
              {addError}
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setAddingTeam(false);
                setNewTeamName("");
                setAddError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              loading={isAdding}
              disabled={!newTeamName.trim()}
              onClick={handleConfirmAdd}
            >
              Add Team
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
