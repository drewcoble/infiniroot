import { Clock } from "lucide-react";
import type { GameState } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// Top-right corner icon for games that aren't over yet: pulsing dot while
// live, a clock before kickoff. Final games and byes get nothing - a
// finished card is the default, quiet state, and the icons only call out
// the ones still to be decided. Sized to the badges beside it.
export function GameStatusGlyph({ state }: { state: GameState }) {
  if (state === "bye" || state === "final") return null;
  return (
    <span className={`${classes.statusSlot} ${classes[`status_${state}`]}`} aria-hidden>
      {state === "live" && <span className={classes.dot} />}
      {state === "pre" && <Clock size={16} strokeWidth={2.5} />}
    </span>
  );
}
