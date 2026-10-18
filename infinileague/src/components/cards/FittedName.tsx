import { useLayoutEffect, useRef, useState } from "react";
import { buildShortNames } from "../../lib/shortPlayerName";
import classes from "./GlassMatchupCard.module.css";

// A full-width card's name on one line: the full name when it fits beside
// the row's badges, else the short form ("M. Harrison Jr." - the same rule
// as the half-width cards), else the short form cut with an ellipsis. Never
// wraps - a wrapped name left the injury badge floating mid-row.
//
// No collision guard here (a lone-name pool), unlike the Matchup tab's
// shortName: these cards also show the headshot and NFL team, which tell
// "B. Robinson" from "B. Robinson Jr.".
//
// Must sit directly in its flex row (.nameRow / .teamCardName): what's left
// for the name is the row's width less its other children and gaps.
export function FittedName({ name }: { name: string }) {
  const nameRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [useShort, setUseShort] = useState(false);
  const shortName = buildShortNames([name])(name);

  useLayoutEffect(() => {
    const nameEl = nameRef.current;
    const measureEl = measureRef.current;
    const row = nameEl?.parentElement;
    if (!nameEl || !measureEl || !row) return;
    const fit = () => {
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      let others = 0;
      for (const child of row.children) {
        if (child === nameEl || child === measureEl) continue;
        others += (child as HTMLElement).offsetWidth + gap;
      }
      // Sub-pixel text widths - round up so a hair's overflow still counts.
      setUseShort(Math.ceil(measureEl.getBoundingClientRect().width) > row.clientWidth - others);
    };
    fit();
    // The row for a resize; the measure too, for a late web font load.
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    observer.observe(measureEl);
    return () => observer.disconnect();
  }, [name]);

  return (
    <>
      <span ref={nameRef} className={`${classes.name} ${classes.fittedName}`}>
        {useShort ? shortName : name}
      </span>
      {/* The full name's natural width, out of the layout. */}
      <span ref={measureRef} className={`${classes.name} ${classes.nameMeasure}`} aria-hidden>
        {name}
      </span>
    </>
  );
}
