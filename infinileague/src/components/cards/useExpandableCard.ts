import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useLongPress } from "./useLongPress";

// Everything a glass player card needs to open its long-press detail card
// (ExpandedMatchupCard): long-press, Enter/Space, and screen-reader
// activation all open it; closing returns focus to the card. Spread
// `cardProps` onto the card's root element and render the detail card
// while `anchor` is set.
export function useExpandableCard(ariaLabel: string) {
  const cardRef = useRef<HTMLDivElement>(null);
  // The element the detail card anchors to, captured at open time - null
  // while collapsed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const expanded = anchor !== null;
  const open = useCallback(() => setAnchor(cardRef.current), []);
  const close = useCallback(() => {
    setAnchor(null);
    cardRef.current?.focus();
  }, []);
  const { pressing, handlers } = useLongPress(open);

  const cardProps = {
    ref: cardRef,
    tabIndex: 0,
    role: "button",
    "aria-haspopup": "dialog",
    "aria-expanded": expanded,
    "aria-label": ariaLabel,
    "aria-description": "Press and hold for details",
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    },
    // Screen readers activate with a synthetic click (detail 0) rather
    // than a long press - let that open the details too, while a real tap
    // (detail 1) stays a no-op so scrolling past cards is safe.
    onClick: (event: MouseEvent) => {
      if (event.detail === 0) open();
    },
    ...handlers,
  } as const;

  return { cardProps, anchor, expanded, pressing, close };
}
