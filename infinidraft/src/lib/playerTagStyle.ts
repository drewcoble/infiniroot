import type { PlayerTag } from "../types";

// Shared color+variant pairing for the target/avoid player tag, so every
// render site (PlayerRow's ActionIcon, PlayerTableRow's ActionIcon,
// PlayerBar's ThemeIcon) pulls from one place instead of hand-writing its
// own bg/c/color+variant combo - which is exactly how PlayerBar.tsx and
// PlayerTableRow.tsx each drifted to a solid "filled" look while PlayerRow.tsx
// stayed on the intended "light" one. Scoped to just this one tag for now -
// the value-gap/consistency flag icons each render site also has are a
// separate, unreconciled set of colors/icons (see PlayerTableRow.tsx's
// comment on CONSISTENCY_ICON) and aren't folded in here.
export function playerTagStyle(tag: PlayerTag): {
  color: string;
  variant: "light";
} {
  return { color: tag === "target" ? "green" : "red", variant: "light" };
}
