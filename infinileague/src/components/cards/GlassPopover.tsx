import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BOTTOM_NAV_BOTTOM_OFFSET, BOTTOM_NAV_HEIGHT } from "@shared/constants";
import classes from "./GlassMatchupCard.module.css";

const MAX_WIDTH = 380;
// Breathing room from the viewport edges, and what's kept clear at the
// bottom for the mobile BottomNav's floating pill.
const EDGE_MARGIN = 12;
const BOTTOM_RESERVE = BOTTOM_NAV_HEIGHT + BOTTOM_NAV_BOTTOM_OFFSET + EDGE_MARGIN;

// The long-press detail popover's shell, shared by every glass card's
// detail view (ExpandedMatchupCard, ExpandedTeamCard). Floats over the page
// (portaled to body, absolutely positioned in document coordinates so it
// scrolls with the content) starting at the base card's own top corner -
// the base card hides underneath while this is open, so it reads as the
// card growing in place without pushing anything else around. Grows toward
// the middle of the screen: left-column cards anchor their left edge,
// right-column cards their right edge. Closes on a tap outside, Escape, or
// a resize; takes focus while open.
export function GlassPopover({
  anchor,
  onClose,
  labelledBy,
  className,
  children,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  // id of the element naming this dialog (its title).
  labelledBy: string;
  // Extra class on the card, e.g. the live tint.
  className?: string | false | undefined;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Positioned directly on the DOM node (not via state) since it depends
  // on the card's own rendered height - one measure-then-place pass before
  // paint, no visible jump.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const width = Math.min(viewportWidth - EDGE_MARGIN * 2, MAX_WIDTH);
    const alignRight = rect.left + rect.width / 2 > viewportWidth / 2;
    const left = Math.min(
      Math.max(alignRight ? rect.right - width : rect.left, EDGE_MARGIN),
      viewportWidth - EDGE_MARGIN - width,
    );
    card.style.width = `${width}px`;
    const bottomLimit = window.innerHeight - BOTTOM_RESERVE;
    const top = Math.max(
      EDGE_MARGIN,
      rect.top + card.offsetHeight > bottomLimit ? bottomLimit - card.offsetHeight : rect.top,
    );
    card.style.left = `${left + window.scrollX}px`;
    card.style.top = `${top + window.scrollY}px`;
    card.style.transformOrigin = `${rect.left + (alignRight ? rect.width : 0) - left}px ${rect.top - top}px`;
    card.dataset.placed = "true";
    card.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // Its position was computed for the old viewport - closing is simpler
    // and less surprising than re-anchoring mid-rotation.
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <>
      {/* onClick rather than onPointerDown: a pointerdown close would let
          the rest of that tap land on whatever's underneath (a tab link,
          say). The release of the long-press that opened this doesn't
          click here either - its pointerdown was on the base card. */}
      <div className={classes.scrim} onClick={onClose} aria-hidden />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={[classes.card, classes.expanded, className].filter(Boolean).join(" ")}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
