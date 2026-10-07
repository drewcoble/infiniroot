import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useLongPress } from "./useLongPress";

// Everything a glass card needs to open its long-press detail popover
// (ExpandedMatchupCard, GlassTeamCard's): long-press always opens it;
// closing returns focus to the card. Spread `cardProps` onto the card's
// root element and render the popover while `anchor` is set.
//
// Two modes:
// - Default (player cards): the card is a button - Enter/Space and a
//   screen reader's activation open the details too.
// - `asLink` (team cards, whose root is a link to the team page): Enter,
//   clicks, and screen-reader activation follow the link natively; Space
//   opens the details instead.
// Either way, the click a long-press release can still produce (iOS
// synthesizes one on the pressed element) is swallowed, so opening a link
// card's popover never navigates away underneath it.
export function useExpandableCard<T extends HTMLElement = HTMLDivElement>(
  ariaLabel: string,
  { asLink = false }: { asLink?: boolean } = {},
) {
  const cardRef = useRef<T>(null);
  // The element the detail card anchors to, captured at open time - null
  // while collapsed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const expanded = anchor !== null;
  const suppressClick = useRef(false);
  const open = useCallback(() => setAnchor(cardRef.current), []);
  const openFromLongPress = useCallback(() => {
    suppressClick.current = true;
    open();
  }, [open]);
  const close = useCallback(() => {
    setAnchor(null);
    cardRef.current?.focus();
  }, []);
  const { pressing, handlers } = useLongPress(openFromLongPress);

  const cardProps = {
    ref: cardRef,
    "aria-label": ariaLabel,
    ...(asLink
      ? ({
          "aria-description": "Press and hold, or press Space, for details",
          draggable: false,
        } as const)
      : ({
          tabIndex: 0,
          role: "button",
          "aria-haspopup": "dialog",
          "aria-expanded": expanded,
          "aria-description": "Press and hold for details",
        } as const)),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === " " || (!asLink && event.key === "Enter")) {
        event.preventDefault();
        open();
      }
    },
    onClick: (event: MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        return;
      }
      // Screen readers activate with a synthetic click (detail 0) rather
      // than a long press - on a button card, let that open the details
      // too, while a real tap (detail 1) stays a no-op so scrolling past
      // cards is safe. Link cards just follow the link.
      if (!asLink && event.detail === 0) open();
    },
    ...handlers,
    // A press that turns into a scroll or ends without opening anything
    // must not leave a stale "swallow the next click" behind.
    onPointerDown: (event: PointerEvent) => {
      suppressClick.current = false;
      handlers.onPointerDown(event);
    },
  };

  return { cardProps, anchor, expanded, pressing, close };
}
