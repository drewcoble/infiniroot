import type { TouchEvent } from "react";
import { useRef } from "react";

// How far (px) a horizontal touch drag has to travel before it counts as a
// deliberate swipe rather than a tap or scroll wobble.
const SWIPE_OPEN_THRESHOLD = 30;

// Detects a left/right swipe gesture (e.g. a table row revealing action
// buttons underneath it) and reports which direction crossed
// SWIPE_OPEN_THRESHOLD. Doesn't track "is this row open" itself - that's
// usually shared, one-row-at-a-time state a parent list already owns (see
// PlayersLeftTab.tsx's swipedFpid), not something each row needs its own
// copy of.
export function useSwipeReveal(onOpen: () => void, onClose: () => void) {
  const startXRef = useRef(0);

  return {
    onTouchStart: (event: TouchEvent) => {
      startXRef.current = event.touches[0]!.clientX;
    },
    onTouchEnd: (event: TouchEvent) => {
      const delta = event.changedTouches[0]!.clientX - startXRef.current;
      if (delta < -SWIPE_OPEN_THRESHOLD) onOpen();
      else if (delta > SWIPE_OPEN_THRESHOLD) onClose();
    },
  };
}
