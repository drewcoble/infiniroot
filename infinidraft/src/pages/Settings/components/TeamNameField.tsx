import { useEffect, useState } from "react";
import { Badge, Group, TextInput } from "@mantine/core";
import { Check } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";
import { useSaveFlash } from "../../../hooks/useSaveFlash";

interface TeamNameFieldProps {
  team: Doc<"seasonTeams">;
  onRename: (name: string) => void;
}

// Saves on blur/Enter rather than on every keystroke - renaming shouldn't
// fire a mutation per character. Reverts the field to the team's current
// name instead of allowing an empty name, and re-syncs if the name changes
// from elsewhere (e.g. the mutation's own round-trip, or another tab).
export function TeamNameField({ team, onRename }: TeamNameFieldProps) {
  const [value, setValue] = useState(team.name);
  const [showSaved, flashSaved] = useSaveFlash();

  useEffect(() => {
    setValue(team.name);
  }, [team.name]);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== team.name) {
      onRename(trimmed);
      flashSaved();
    } else {
      setValue(team.name);
    }
  };

  return (
    <Group gap={4} wrap="nowrap">
      <TextInput
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        w={180}
        rightSection={
          team.isSelf ? (
            <Badge variant="light" size="sm">
              you
            </Badge>
          ) : undefined
        }
        rightSectionWidth={team.isSelf ? 50 : undefined}
      />
      {showSaved && <Check size={14} color="var(--mantine-color-teal-6)" />}
    </Group>
  );
}
