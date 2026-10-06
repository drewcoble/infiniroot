import { Check, Clock } from "lucide-react";
import type { GameState } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// Top-right corner icon for where a player's game stands, so it reads at a
// glance rather than only from the game line's trailing text ("Final") or
// the meter's color: pulsing dot while live, a plain check once final (no
// circle, so it can't be mistaken for the clock), and a clock before
// kickoff. Byes get nothing - the card is already dimmed. Sized to the
// badges beside it.
export function GameStatusGlyph({ state }: { state: GameState }) {
  if (state === "bye") return null;
  return (
    <span className={`${classes.statusSlot} ${classes[`status_${state}`]}`} aria-hidden>
      {state === "live" && <span className={classes.dot} />}
      {state === "final" && <Check size={17} strokeWidth={3} />}
      {state === "pre" && <Clock size={16} strokeWidth={2.5} />}
    </span>
  );
}
