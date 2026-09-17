import { useState } from "react";
import { EditableNumberStepper } from "@infiniroot/shared";

export function Default() {
  const [value, setValue] = useState<number | undefined>(46);
  return <EditableNumberStepper value={value} onChange={setValue} label="Bid" prefix="$" />;
}

export function Empty() {
  const [value, setValue] = useState<number | undefined>(undefined);
  return (
    <EditableNumberStepper
      value={value}
      onChange={setValue}
      label="Minimum cost"
      prefix="$"
      placeholder="None"
      nullable
    />
  );
}

export function Disabled() {
  return (
    <EditableNumberStepper value={12} onChange={() => {}} label="Keeper cost" prefix="$" disabled />
  );
}
