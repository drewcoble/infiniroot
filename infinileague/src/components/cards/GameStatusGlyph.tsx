import { Check, Clock } from "lucide-react";
import type { GameState } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// Leading icon on the game line, so where a player's game stands reads from
// the start of the line rather than only from its trailing text ("Final")
// or the meter's color: pulsing dot while live, a plain check once final
// (no circle, so it can't be mistaken for the clock), and a clock before
// kickoff. Byes get nothing - the card is already dimmed. One fixed width
// for all three so game lines stay aligned across cards.
export function GameStatusGlyph({ state }: { state: GameState }) {
  if (state === "bye") return null;
  return (
    <span className={`${classes.statusSlot} ${classes[`status_${state}`]}`} aria-hidden>
      {state === "live" && <span className={classes.dot} />}
      {state === "final" && <Check size={14} strokeWidth={3} />}
      {state === "pre" && <Clock size={13} strokeWidth={2.5} />}
    </span>
  );
}
