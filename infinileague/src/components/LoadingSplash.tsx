import { useEffect, useState, useSyncExternalStore } from "react";
import { Text } from "@mantine/core";
import logo from "@shared/infini_logo.png";
import classes from "./LoadingSplash.module.css";

// Full-viewport loading splash - the app logo centered, breathing softly,
// over everything (header and bottom nav included). One overlay, mounted
// once in __root.tsx; anything that's loading holds it open with
// useLoadingSplash, so back-to-back loads (auth, then the dashboard's
// leagues) read as one splash instead of flickering between two.
let holds = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return holds > 0;
}

export function useLoadingSplash(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    holds += 1;
    emit();
    return () => {
      holds -= 1;
      emit();
    };
  }, [active]);
}

// A short grace period before fading out, so a hold handed straight to the
// next one doesn't start a fade; then long enough for the fade itself.
const HIDE_DELAY_MS = 150;
const FADE_OUT_MS = 400;

export function LoadingSplash() {
  const active = useSyncExternalStore(subscribe, getSnapshot);
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">(active ? "shown" : "gone");

  useEffect(() => {
    if (active) {
      setPhase("shown");
      return;
    }
    const leave = setTimeout(
      () => setPhase((current) => (current === "gone" ? current : "leaving")),
      HIDE_DELAY_MS,
    );
    const gone = setTimeout(() => setPhase("gone"), HIDE_DELAY_MS + FADE_OUT_MS);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, [active]);

  if (phase === "gone") {
    return null;
  }

  return (
    <div
      className={classes.overlay}
      data-leaving={phase === "leaving" || undefined}
      role="status"
      aria-label="Loading"
    >
      <div className={classes.logo}>
        <img src={logo} alt="" className={classes.mark} />
        <span className={classes.wordmark}>
          <Text component="span" inherit c="saddlebrown.7">
            infini
          </Text>
          league
        </span>
      </div>
    </div>
  );
}
