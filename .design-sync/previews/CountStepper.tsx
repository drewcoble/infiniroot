import { useState } from "react";
import { CountStepper } from "@infiniroot/shared";

export function Default() {
  const [value, setValue] = useState<number | undefined>(2);
  return <CountStepper value={value} onChange={setValue} label="QB" min={0} max={4} />;
}

export function Unlimited() {
  const [value, setValue] = useState<number | undefined>(undefined);
  return (
    <CountStepper
      value={value}
      onChange={setValue}
      label="Bench"
      placeholder="Unlimited"
      nullable
    />
  );
}

export function AtMax() {
  const [value, setValue] = useState<number | undefined>(4);
  return <CountStepper value={value} onChange={setValue} label="WR" min={0} max={4} />;
}

export function Disabled() {
  return <CountStepper value={1} onChange={() => {}} label="TE" disabled />;
}
