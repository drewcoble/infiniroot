import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Badge,
  Button,
  Card,
  Combobox,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from "@mantine/core";
import { X } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { POSITION_COLORS } from "@shared/positionColors";
import { EditableNumberStepper } from "../../../components/NumberStepper";
import { WEEK } from "../../../constants/general";
import type { Position } from "../../../types";
import { getErrorMessage } from "@shared/errors";

interface ManualPreviousSeasonModalProps {
  seasonId: Id<"seasons">;
  currentYear: string;
  opened: boolean;
  onClose: () => void;
  // A snake/linear league needs each player's prior ROUND for keeper cost
  // (SNAKE_DRAFT.md §8), not a dollar price - branches the stepper's
  // label/prefix below and which field handleSave sends. Decided by the
  // CURRENT season's format, not whatever format the history being edited
  // originally came from.
  isSnakeOrLinear: boolean;
}

interface PlayerDraft {
  fpid: number;
  name: string;
  position: Position;
  // A dollar price or a round number depending on isSnakeOrLinear - see
  // that prop's comment. Generic name since this same draft shape is used
  // for both formats. Undefined in round mode means "wasn't drafted/kept
  // last season, no known round" (SNAKE_DRAFT.md §8's undraftedRound
  // fallback handles this at cost-computation time) - NOT round 1, which
  // would misleadingly claim they were a premium pick. Dollar mode has no
  // such gap (0 already means "undrafted" there - see keeperCost.ts's
  // computeKeeperCost), so it always keeps a real number.
  cost: number | undefined;
}

interface TeamDraft {
  // Local-only identity for React keys/edits - not sent to the mutation
  // (which just takes name/isSelf/players and creates fresh seasonTeams
  // rows either way, same as importPreviousSeasonHistory does for
  // provider imports).
  key: string;
  name: string;
  isSelf: boolean;
  players: PlayerDraft[];
}

const UNASSIGNED_KEY = "__unassigned__";

// Search-and-add row for one team - same compact pattern
// KeeperTierPlayerPicker.tsx uses, minus the maxSize/otherTiers plumbing
// that's specific to that feature.
function PlayerSearchAdd({
  candidates,
  excludeFpids,
  onAdd,
  portalTarget,
}: {
  candidates: PlayerDraft[];
  excludeFpids: Set<number>;
  onAdd: (player: PlayerDraft) => void;
  portalTarget: HTMLDivElement | null;
}) {
  const [search, setSearch] = useState("");
  // Blurred once a player's added so the on-screen keyboard on iOS/Android
  // doesn't stick around covering the rest of this team's row.
  const inputRef = useRef<HTMLInputElement>(null);
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  });

  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (query.length < 2) return [];
    return candidates
      .filter(
        (row) =>
          !excludeFpids.has(row.fpid) && row.name.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [candidates, excludeFpids, search]);

  return (
    <Combobox
      store={combobox}
      // This picker lives inside both a Modal (which traps focus within its
      // own DOM subtree - the default portal-to-body dropdown falls outside
      // that trap and gets yanked closed) and a ScrollArea (whose overflow
      // clips an un-portaled dropdown that flips above the input when the
      // keyboard covers the space below). Portaling to a target that's a
      // sibling of the ScrollArea, but still inside the Modal, avoids both.
      withinPortal={!!portalTarget}
      {...(portalTarget ? { portalProps: { target: portalTarget } } : {})}
      onOptionSubmit={(value) => {
        const player = candidates.find((row) => String(row.fpid) === value);
        combobox.closeDropdown();
        inputRef.current?.blur();
        if (!player) return;
        onAdd(player);
        setSearch("");
      }}
    >
      <Combobox.Target>
        <TextInput
          ref={inputRef}
          size="xs"
          placeholder="Search a player to add..."
          value={search}
          // iOS's autocorrect/QuickType bar doesn't recognize most player
          // surnames (e.g. "Nabers") and pops up a suggestion strip that
          // sits on top of the dropdown below, eating the first tap on an
          // option. This is a search field, not prose - nothing here
          // benefits from autocorrect anyway.
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            combobox.openDropdown();
          }}
          onFocus={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options mah={200} style={{ overflowY: "auto" }}>
          {results.length === 0 ? (
            <Combobox.Empty>
              {search.trim().length < 2
                ? "Type at least 2 characters..."
                : "No players found"}
            </Combobox.Empty>
          ) : (
            results.map((row) => (
              <Combobox.Option value={String(row.fpid)} key={row.fpid}>
                <Group gap={6} wrap="nowrap">
                  <Badge
                    size="sm"
                    variant="light"
                    color={POSITION_COLORS[row.position]}
                  >
                    {row.position}
                  </Badge>
                  <Text size="sm">{row.name}</Text>
                </Group>
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

// Lets a host backfill last season's results by hand - team by team,
// searching for whoever they remember each team keeping/drafting - so
// Recommended Keepers (KeepersTab.tsx) has something to work from without
// needing a Sleeper/Yahoo-linked league. Doubles as the edit/correction
// flow for a season that's already got history data: opening this for a
// year that already has manually-entered OR provider-imported data (see
// getManualPreviousSeasonEntry - anything with a historySource at all)
// pre-fills every row, and Save fully replaces whatever was there before -
// same "resubmit the whole form" pattern as e.g. TeamsPanel's nomination
// order. Saving here always re-tags the season as manually-entered
// afterward, regardless of how it originally got there.
export function ManualPreviousSeasonModal({
  seasonId,
  currentYear,
  opened,
  onClose,
  isSnakeOrLinear,
}: ManualPreviousSeasonModalProps) {
  // Always the season immediately before the one being set up - there's no
  // scenario where a host would want to backfill any other year here.
  const year = String(Number(currentYear) - 1);
  const [teams, setTeams] = useState<TeamDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Target for the player-search dropdowns below to portal into - see
  // PlayerSearchAdd's comment for why it can't be document.body (default)
  // or un-portaled (the two options Combobox normally offers).
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);

  const currentTeams = useQuery(api.infinidraft.draft.teams.listSeasonTeams, {
    seasonId,
  });
  const existingEntry = useQuery(
    api.infinidraft.draft.manualHistory.getManualPreviousSeasonEntry,
    opened ? { seasonId, year } : "skip",
  );
  const allProjections = useQuery(
    api.projections.getAllProjections,
    opened ? { week: WEEK } : "skip",
  );
  const setResults = useMutation(
    api.infinidraft.draft.manualHistory.setManualPreviousSeasonResults,
  );

  const nameByFpid = useMemo(() => {
    const map = new Map<number, PlayerDraft>();
    for (const row of allProjections ?? []) {
      map.set(row.fpid, {
        fpid: row.fpid,
        name: row.name,
        position: row.position,
        // A newly-added player's round starts blank ("not drafted") rather
        // than guessed at round 1 - the host fills it in only if they
        // actually remember/know it. Dollar mode keeps its existing "$1"
        // starting point.
        cost: isSnakeOrLinear ? undefined : 1,
      });
    }
    return map;
  }, [allProjections, isSnakeOrLinear]);

  // Re-derive the form's rows whenever the modal opens. Always start from
  // today's current-season teams plus the fixed Unassigned bucket, then
  // layer in whatever was previously recorded for each one (matched by name
  // - the only stable join key available, since the mutation doesn't keep
  // an FK back to seasonTeams). This way a team nobody entered a player for
  // last time still shows up here instead of disappearing (a prior version
  // of this effect trusted the saved rows alone, so a team with 0 players -
  // which never got a seasonTeams row in the first place - vanished from
  // the form on the next edit). Any recorded team that no longer matches a
  // current one (renamed/removed) is kept too, just without a matching
  // current-team row, so past entries are never silently dropped.
  // Deliberately not dependent on `teams` itself, so typing in the form
  // doesn't get stomped - only opening the modal resets it.
  useEffect(() => {
    if (!opened || currentTeams === undefined || existingEntry === undefined) {
      return;
    }

    const toPlayerDrafts = (
      players: {
        fpid: number;
        price: number | undefined;
        round: number | undefined;
      }[],
    ) =>
      players.map((p) => {
        const known = nameByFpid.get(p.fpid);
        return {
          fpid: p.fpid,
          // Read whichever field matches the CURRENT season's format. In
          // round mode a genuinely missing round (undrafted/waiver pickup,
          // or history recorded under a different format) stays undefined
          // ("not drafted") rather than guessing round 1 - see PlayerDraft's
          // comment. Dollar mode keeps its existing "$0 means undrafted"
          // convention.
          cost: isSnakeOrLinear ? p.round : (p.price ?? 0),
          name: known?.name ?? `#${p.fpid}`,
          position: known?.position ?? "RB",
        };
      });

    const existingByName = new Map(
      (existingEntry?.teams ?? []).map((team) => [team.name, team]),
    );

    const merged: TeamDraft[] = currentTeams.map((team) => {
      const existing = existingByName.get(team.name);
      existingByName.delete(team.name);
      return {
        key: team._id,
        name: team.name,
        isSelf: team.isSelf,
        players: existing ? toPlayerDrafts(existing.players) : [],
      };
    });

    const existingUnassigned = existingByName.get("Unassigned");
    existingByName.delete("Unassigned");
    merged.push({
      key: UNASSIGNED_KEY,
      name: "Unassigned",
      isSelf: false,
      players: existingUnassigned
        ? toPlayerDrafts(existingUnassigned.players)
        : [],
    });

    for (const [name, team] of existingByName) {
      merged.push({
        key: `orphaned-${name}`,
        name,
        isSelf: team.isSelf,
        players: toPlayerDrafts(team.players),
      });
    }

    setTeams(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, currentTeams, existingEntry]);

  const allDraftPlayers = useMemo(
    () => Array.from(nameByFpid.values()),
    [nameByFpid],
  );
  const usedFpids = useMemo(
    () => new Set(teams.flatMap((t) => t.players.map((p) => p.fpid))),
    [teams],
  );

  const addPlayer = (teamKey: string, player: PlayerDraft) => {
    setTeams((current) =>
      current.map((t) =>
        t.key === teamKey ? { ...t, players: [...t.players, player] } : t,
      ),
    );
  };

  const removePlayer = (teamKey: string, fpid: number) => {
    setTeams((current) =>
      current.map((t) =>
        t.key === teamKey
          ? { ...t, players: t.players.filter((p) => p.fpid !== fpid) }
          : t,
      ),
    );
  };

  const setCost = (
    teamKey: string,
    fpid: number,
    cost: number | undefined,
  ) => {
    setTeams((current) =>
      current.map((t) =>
        t.key === teamKey
          ? {
              ...t,
              players: t.players.map((p) =>
                p.fpid === fpid ? { ...p, cost } : p,
              ),
            }
          : t,
      ),
    );
  };

  const totalPlayers = teams.reduce((sum, t) => sum + t.players.length, 0);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await setResults({
        seasonId,
        year,
        // Deliberately not filtering out teams with 0 players here - doing
        // so used to mean a team nobody had entered a keeper for yet
        // wouldn't get a seasonTeams row at all, so it vanished from the
        // form entirely on the next edit instead of just showing empty.
        teams: teams.map((t) => ({
          name: t.name,
          isSelf: t.isSelf,
          players: t.players.map((p) => ({
            fpid: p.fpid,
            // Undefined round (round mode only - see PlayerDraft's
            // comment) is sent as "not present" rather than coerced to a
            // number, so computeKeeperCostRound's undraftedRound fallback
            // applies instead of a made-up round.
            ...(isSnakeOrLinear
              ? p.cost !== undefined
                ? { round: p.cost }
                : {}
              : { price: p.cost ?? 0 }),
          })),
        })),
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save last season's results."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Enter last season's results"
      size="lg"
    >
      <Stack gap="md">
        <div ref={setPortalTarget} />
        <ScrollArea.Autosize mah={420}>
          <Stack gap="sm">
            {teams.map((team) => (
              <Card key={team.key} withBorder padding="sm">
                <Stack gap={6}>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>
                      {team.name}
                    </Text>
                    {team.isSelf && (
                      <Badge size="xs" variant="light">
                        You
                      </Badge>
                    )}
                  </Group>
                  {team.players.map((player) => (
                    <Group key={player.fpid} gap={6} wrap="nowrap">
                      <Badge
                        size="sm"
                        variant="light"
                        color={POSITION_COLORS[player.position]}
                      >
                        {player.position}
                      </Badge>
                      <Text size="sm" flex={1}>
                        {player.name}
                      </Text>
                      <EditableNumberStepper
                        label={`${player.name} ${isSnakeOrLinear ? "round" : "price"}`}
                        min={isSnakeOrLinear ? 1 : 0}
                        width={80}
                        size="xs"
                        {...(isSnakeOrLinear
                          ? { nullable: true, placeholder: "Not drafted" }
                          : { prefix: "$" })}
                        value={player.cost}
                        onChange={(value) =>
                          setCost(
                            team.key,
                            player.fpid,
                            isSnakeOrLinear ? value : (value ?? 0),
                          )
                        }
                      />
                      <Button
                        variant="subtle"
                        color="gray"
                        size="xs"
                        px={4}
                        onClick={() => removePlayer(team.key, player.fpid)}
                        aria-label={`Remove ${player.name}`}
                      >
                        <X size={14} />
                      </Button>
                    </Group>
                  ))}
                  <PlayerSearchAdd
                    candidates={allDraftPlayers}
                    excludeFpids={usedFpids}
                    onAdd={(player) => addPlayer(team.key, player)}
                    portalTarget={portalTarget}
                  />
                </Stack>
              </Card>
            ))}
          </Stack>
        </ScrollArea.Autosize>
        {error && (
          <Text c="red" size="sm">
            {error}
          </Text>
        )}
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {totalPlayers} player{totalPlayers === 1 ? "" : "s"} entered
          </Text>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              loading={isSaving}
              disabled={totalPlayers === 0}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
