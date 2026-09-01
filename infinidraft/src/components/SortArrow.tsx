import { ArrowDown, ArrowUp } from "lucide-react";
import type { SortDir } from "../lib/tableSort";

interface SortArrowProps {
  dir: SortDir;
  size?: number;
}

// Direction indicator for a clickable sortable column header - only
// rendered next to whichever header is currently active (see
// PlayersTable.tsx/PlayersLeftTab.tsx).
export function SortArrow({ dir, size = 12 }: SortArrowProps) {
  return dir === "asc" ? <ArrowUp size={size} /> : <ArrowDown size={size} />;
}
