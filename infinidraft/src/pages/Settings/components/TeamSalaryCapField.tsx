import { useEffect, useState } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { Check } from "lucide-react";
import type { Doc } from "@infinidata/dataModel";
import { EditableNumberStepper } from "../../../components/NumberStepper";

interface TeamSalaryCapFieldProps {
  team: Doc<"seasonTeams">;
  leagueSalaryCap: number;
  editing: boolean;
  onSetSalaryCap: (salaryCap: number | null) => void;
}

// Unlike TeamNameField, this doesn't auto-save on blur - a cap override
// changes what a team can spend for the rest of the draft, and a stray
// scroll-wheel bump or tab-through-the-row blur shouldn't be able to change
// it silently. Edits stay local until the check button is clicked.
//
// Read-only by default (`editing` false) - this field used to always render
// as a live NumberInput sitting in a dense row of controls, and it was too
// easy to click/scroll into by accident while reaching for the neighboring
// reorder buttons. TeamsPanel's "Edit Caps" toggle switches every row into
// the NumberInput at once instead.
export function TeamSalaryCapField({
  team,
  leagueSalaryCap,
  editing,
  onSetSalaryCap,
}: TeamSalaryCapFieldProps) {
  const committed: number | undefined = team.salaryCapOverride;
  const [value, setValue] = useState<number | undefined>(committed);

  useEffect(() => {
    setValue(committed);
  }, [committed]);

  const isDirty = value !== committed;

  const handleSave = () => {
    onSetSalaryCap(value === undefined ? null : value);
  };

  if (!editing) {
    return (
      <Text
        size="sm"
        {...(team.salaryCapOverride === undefined ? { c: "dimmed" } : {})}
        w={100}
      >
        {team.salaryCapOverride !== undefined
          ? `$${team.salaryCapOverride}`
          : `$${leagueSalaryCap}`}
      </Text>
    );
  }

  return (
    <Group gap={4} wrap="nowrap">
      <EditableNumberStepper
        label="Salary cap override"
        value={value}
        onChange={setValue}
        onKeyDown={(event) => {
          if (event.key === "Enter" && isDirty) handleSave();
        }}
        placeholder={String(leagueSalaryCap)}
        min={1}
        prefix="$"
        width={100}
        nullable
      />
      <Tooltip label={isDirty ? "Save cap override" : "Saved"}>
        <ActionIcon
          variant={isDirty ? "filled" : "default"}
          color="teal"
          size={40}
          disabled={!isDirty}
          onClick={handleSave}
        >
          <Check size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
