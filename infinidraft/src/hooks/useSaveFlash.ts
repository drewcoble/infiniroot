import { useEffect, useRef, useState } from "react";

// Briefly flashes a "saved" confirmation after an auto-patch field commits
// (e.g. on blur) with no dedicated Save button of its own - see
// TeamNameField and KeeperStreakCell - so the user gets some positive
// feedback that the mutation actually fired.
export function useSaveFlash(durationMs = 1500) {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  const flash = () => {
    setIsVisible(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsVisible(false), durationMs);
  };

  return [isVisible, flash] as const;
}
