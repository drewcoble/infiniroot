import { useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Badge,
  Group,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { X } from "lucide-react";
import { POSITION_COLORS } from "@shared/positionColors";
import { STEPPER_BUTTON_SIZE } from "../../../constants/general";
import type { Position } from "../../../types";

interface PlayerOption {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

interface KeeperTierPlayerPickerProps {
  fpids: number[];
  maxSize: number | undefined;
  otherTiersFpids: Set<number>;
  nameByFpid: Map<number, PlayerOption>;
  searchResults: PlayerOption[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggle: (fpid: number) => void;
}

// Search-and-toggle picker for one keeper tier's designated players -
// mirrors KeeperSearchForm's search box, but a checkbox-like toggle instead
// of a one-way "Add as Keeper" action since membership here is just
// reversible list membership, not a committed draft pick.
export function KeeperTierPlayerPicker({
  fpids,
  maxSize,
  otherTiersFpids,
  nameByFpid,
  searchResults,
  search,
  onSearchChange,
  onToggle,
}: KeeperTierPlayerPickerProps) {
  const [showResults, setShowResults] = useState(false);
  const atCapacity = maxSize !== undefined && fpids.length >= maxSize;
  // Blurred once a player's added so the on-screen keyboard on iOS/Android
  // doesn't stick around covering the results list.
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () =>
      fpids
        .map((fpid) => nameByFpid.get(fpid))
        .filter((row): row is PlayerOption => !!row),
    [fpids, nameByFpid],
  );

  return (
    <Stack gap={6}>
      <Group gap={4} wrap="wrap">
        {selected.length === 0 ? (
          <Text size="xs" c="dimmed">
            No players designated yet.
          </Text>
        ) : (
          selected.map((row) => (
            <Badge
              key={row.fpid}
              variant="light"
              color={POSITION_COLORS[row.position]}
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color={POSITION_COLORS[row.position]}
                  onClick={() => onToggle(row.fpid)}
                  aria-label={`Remove ${row.name}`}
                >
                  <X size={10} />
                </ActionIcon>
              }
            >
              {row.name}
            </Badge>
          ))
        )}
      </Group>
      <TextInput
        ref={inputRef}
        size="xs"
        placeholder={
          atCapacity
            ? `Rule full (${fpids.length}/${maxSize})`
            : "Search a player to add..."
        }
        disabled={atCapacity}
        value={search}
        // iOS's autocorrect/QuickType bar doesn't recognize most player
        // surnames and pops a suggestion strip on top of the results list
        // below, eating the first tap on an option - see
        // ManualPreviousSeasonModal.tsx's copy of this same fix.
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          onSearchChange(event.currentTarget.value);
          setShowResults(true);
        }}
        onFocus={() => setShowResults(true)}
      />
      {showResults && search.trim().length >= 2 && searchResults.length > 0 && (
        <Stack gap={2}>
          {searchResults.map((row) => {
            const inOtherTier = otherTiersFpids.has(row.fpid);
            return (
              <Group key={row.fpid} gap={6} wrap="nowrap">
                <Badge
                  variant="light"
                  color={POSITION_COLORS[row.position]}
                  size="sm"
                >
                  {row.position}
                </Badge>
                <Text size="xs" flex={1}>
                  {row.name}
                  {row.team ? ` (${row.team})` : ""}
                </Text>
                <ActionIcon
                  size={STEPPER_BUTTON_SIZE}
                  variant="default"
                  disabled={inOtherTier || atCapacity}
                  aria-label={`Add ${row.name}`}
                  title={
                    inOtherTier
                      ? "Already designated in another rule"
                      : undefined
                  }
                  onClick={() => {
                    onToggle(row.fpid);
                    onSearchChange("");
                    setShowResults(false);
                    inputRef.current?.blur();
                  }}
                >
                  +
                </ActionIcon>
              </Group>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
