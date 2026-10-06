import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";

// How long a press has to be held to count, and how far the pointer can
// drift before it's treated as the start of a scroll instead. A touch that
// turns into a scroll also fires pointercancel, which cancels it too.
const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 8;

// Long-press detection over pointer events, so touch and mouse share one
// path. `pressing` is true while a press is being held, for the card's
// "keep holding" feedback - see .pressing in GlassMatchupCard.module.css.
export function useLongPress(onLongPress: () => void) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [pressing, setPressing] = useState(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = null;
    setPressing(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  const handlers = {
    onPointerDown: (event: PointerEvent) => {
      if (event.button !== 0) return;
      start.current = { x: event.clientX, y: event.clientY };
      setPressing(true);
      timer.current = window.setTimeout(() => {
        cancel();
        navigator.vibrate?.(10);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!start.current) return;
      const moved = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y);
      if (moved > MOVE_TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    // Android/desktop open a context menu on long-press/right-click - that
    // gesture is ours now.
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
  };

  return { pressing, handlers };
}
