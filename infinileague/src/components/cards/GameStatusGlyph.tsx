import { CircleCheck } from "lucide-react";
import type { GameState } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// Leading icon on the game line, so where a player's game stands reads from
// the start of the line rather than only from its trailing text ("Final")
// or the meter's color: pulsing dot while live, check once final, clock
// before kickoff, its hands set to the kickoff time. Byes get nothing - the card is already dimmed. One fixed
// width for all three so game lines stay aligned across cards.
export function GameStatusGlyph({
  state,
  kickoffAt,
}: {
  state: GameState;
  kickoffAt?: number | undefined;
}) {
  if (state === "bye") return null;
  return (
    <span className={`${classes.statusSlot} ${classes[`status_${state}`]}`} aria-hidden>
      {state === "live" && <span className={classes.dot} />}
      {state === "final" && <CircleCheck size={13} strokeWidth={2.5} />}
      {state === "pre" && <KickoffClock kickoffAt={kickoffAt} />}
    </span>
  );
}

// Clock face drawn to match lucide's Clock (same 24-unit box and stroke) so
// it sits with the other icons, but with the hands at kickoff in the
// viewer's own time zone - the same zone formatGameLine prints "Sun 4:25 PM"
// in. No kickoff known falls back to lucide's own 12:00/4:00-ish pose.
const CLOCK_STEP_MINUTES = 15;

function KickoffClock({ kickoffAt }: { kickoffAt?: number | undefined }) {
  // Rounded to the nearest quarter hour - at 13px, 4:25's hands sit almost
  // on top of each other, while 4:30's read clearly. The text beside it
  // still has the exact time.
  const kickoff = kickoffAt !== undefined ? new Date(kickoffAt) : undefined;
  const exactMinutes = kickoff ? kickoff.getHours() * 60 + kickoff.getMinutes() : 4 * 60;
  const totalMinutes = Math.round(exactMinutes / CLOCK_STEP_MINUTES) * CLOCK_STEP_MINUTES;
  const minutes = totalMinutes % 60;
  const hours = (totalMinutes / 60) % 12;
  const hand = (degrees: number, length: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x2: 12 + length * Math.sin(radians), y2: 12 - length * Math.cos(radians) };
  };
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
    >
      <circle cx={12} cy={12} r={10} />
      <line x1={12} y1={12} {...hand(hours * 30, 4.5)} />
      <line x1={12} y1={12} {...hand(minutes * 6, 6.5)} />
    </svg>
  );
}
