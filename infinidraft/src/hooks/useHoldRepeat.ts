import { useEffect, useRef } from "react";

// A quick tap still fires the button's own onClick exactly once (that keeps
// keyboard activation - Enter/Space - working too, since those only ever
// dispatch click, never pointer events). Holding past INITIAL_DELAY_MS
// starts repeating separately via this hook's pointerDown-driven interval,
// so a stepper can be held down to run a value up/down quickly instead of
// needing dozens of individual taps - the two mechanisms never fire for the
// same "tick" (click only ever lands once, at release), so nothing double-
// counts.
const INITIAL_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 90;

export function useHoldRepeat(onStep: () => void) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref rather than a plain closure over `onStep` - the interval/timeout
  // are only ever set up once per press, but `onStep` (an inline arrow
  // function at most call sites) is a new reference every render, so
  // reading it through a ref keeps the repeat loop calling the latest
  // version without needing to restart the timers on every render.
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  const stop = () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    if (intervalRef.current !== null) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  };

  // Unmounting mid-hold (e.g. the row it's on disappears) must not leave a
  // dangling interval calling into a torn-down component.
  useEffect(() => stop, []);

  const start = () => {
    stop();
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(
        () => onStepRef.current(),
        REPEAT_INTERVAL_MS,
      );
    }, INITIAL_DELAY_MS);
  };

  return {
    onPointerDown: start,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
  };
}
