import { useEffect, useState } from "react";

// iOS Safari's `position: fixed` is anchored to the LAYOUT viewport (the
// full screen height, as if the browser's own toolbar didn't exist), not
// the VISUAL viewport (what's actually visible once that toolbar - which
// auto-collapses to a compact form on scroll - takes its space back). A
// `bottom: 0` fixed element doesn't track that transition: once the
// toolbar collapses (revealing more screen), the fixed element stays put
// at its old layout-viewport-relative position, leaving a gap of real page
// content visible below it for the rest of the scroll (confirmed via a
// frame-by-frame screen recording - reported as the BottomNav "sticking
// partway up the page"). No CSS-only fix exists for this reference-frame
// mismatch; `window.visualViewport` is the browser's own API for exposing
// the gap, so this measures it directly and callers add it to their own
// `bottom` offset to compensate.
export function useVisualViewportBottomGap(): number {
  const [gap, setGap] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const bottomGap = window.innerHeight - (vv.height + vv.offsetTop);
      setGap(Math.max(0, Math.round(bottomGap)));
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return gap;
}
