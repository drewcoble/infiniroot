import { ArrowDown, ArrowUp } from "lucide-react";

export type SortDir = "asc" | "desc";

interface SortArrowProps {
  dir: SortDir;
  size?: number;
}

// Direction indicator for a clickable sortable column header - only
// rendered next to whichever header is currently active.
export function SortArrow({ dir, size = 12 }: SortArrowProps) {
  return dir === "asc" ? <ArrowUp size={size} /> : <ArrowDown size={size} />;
}
