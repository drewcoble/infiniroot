import { useState } from "react";
import { PositionFilterBar } from "@infiniroot/shared";
import type { Position } from "@infiniroot/shared";

const ALL_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "DST", "K"];

export function NoneSelected() {
  const [selected, setSelected] = useState<Position[]>([]);
  return (
    <PositionFilterBar positions={ALL_POSITIONS} selected={selected} onChange={setSelected} top={0} />
  );
}

export function SomeSelected() {
  const [selected, setSelected] = useState<Position[]>(["QB", "RB"]);
  return (
    <PositionFilterBar positions={ALL_POSITIONS} selected={selected} onChange={setSelected} top={0} />
  );
}
