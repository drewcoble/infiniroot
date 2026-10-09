import type { CSSProperties } from "react";
import classes from "./GlassMatchupCard.module.css";

// Matchup page's "Live only" switch - a glass chip like the Players position
// filter's, filled green while on, with the cards' pulsing live dot.
export function LiveOnlyToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      className={`${classes.filterChip} ${on ? classes.filterChipSelected : ""}`}
      style={{ "--chip-fill": "#15803d" } as CSSProperties}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      <span className={classes.dot} aria-hidden />
      Live only
    </button>
  );
}
