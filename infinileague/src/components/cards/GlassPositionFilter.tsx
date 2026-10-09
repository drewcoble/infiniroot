import type { CSSProperties } from "react";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import classes from "./GlassMatchupCard.module.css";

// Players board position filter: a row of glass chips that sticks just under
// the header while the list scrolls (no bar behind it - each chip carries
// its own glass, like the header's pieces). Selected chips fill solid with
// their position's color.
//
// Taps: with everything showing, tapping a position isolates it (the old
// filter's "only" badge, without the extra control); after that, taps add
// or remove positions, and clearing the last one shows everything again.
// "All" resets.
export function GlassPositionFilter({
  positions,
  selected,
  onChange,
}: {
  positions: readonly Position[];
  selected: Position[];
  onChange: (positions: Position[]) => void;
}) {
  const allSelected = positions.every((position) => selected.includes(position));

  const toggle = (position: Position) => {
    if (allSelected) {
      onChange([position]);
      return;
    }
    const next = selected.includes(position)
      ? selected.filter((p) => p !== position)
      : [...selected, position];
    onChange(next.length === 0 ? [...positions] : next);
  };

  return (
    <div className={classes.filterRow} role="group" aria-label="Filter by position">
      <button
        type="button"
        className={`${classes.filterChip} ${allSelected ? classes.filterChipSelected : ""}`}
        style={{ "--chip-fill": "var(--mantine-color-gray-7)" } as CSSProperties}
        aria-pressed={allSelected}
        onClick={() => onChange([...positions])}
      >
        All
      </button>
      {positions.map((position) => {
        const isSelected = !allSelected && selected.includes(position);
        const color = positionColorOrDefault(position);
        return (
          <button
            key={position}
            type="button"
            className={`${classes.filterChip} ${isSelected ? classes.filterChipSelected : ""}`}
            style={
              {
                "--chip-fill": `var(--mantine-color-${color}-7)`,
              } as CSSProperties
            }
            aria-pressed={isSelected}
            onClick={() => toggle(position)}
          >
            {position}
          </button>
        );
      })}
    </div>
  );
}
