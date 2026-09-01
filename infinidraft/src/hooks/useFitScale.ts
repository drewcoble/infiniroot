import { useCallback, useEffect, useState } from "react";

interface UseFitScaleOptions {
  minScale?: number;
  maxScale?: number;
}

// Measures contentRef's natural (unscaled) size and computes the scale
// factor needed to fit it entirely within containerRef's available size,
// re-measuring on any resize of either via ResizeObserver - covers both the
// container resizing (window/display resolution change) and the content
// resizing (e.g. DraftBoard.tsx's roster rows changing as picks come in),
// with no extra dependency tracking needed since ResizeObserver reacts to
// both generically.
//
// Meant to be paired with `transform: scale(...)` on the content element:
// it renders at whatever size it naturally wants (its own font-sizes,
// paddings, gaps, unscaled) and gets uniformly scaled up/down to exactly
// fill the container, rather than needing every size value in the tree
// individually recomputed against a shared variable. Transforms don't
// affect layout-box metrics (scrollWidth/scrollHeight) or ResizeObserver's
// reported size, so re-measuring after a scale is already applied still
// reads the content's true unscaled size - no feedback loop.
//
// Callback refs backed by state, not plain useRef - a caller that renders a
// loading state first (containerRef/contentRef unattached, both null) and
// only mounts the real content once data loads needs the measurement
// effect to actually re-run once that happens. A plain useRef's `.current`
// mutating doesn't trigger anything on its own, and an effect with a fixed
// dependency array (e.g. just [minScale, maxScale]) only ever runs once
// with both refs still null - it never gets a second chance to see the
// real content, so `scale` stays stuck at its initial 1 forever. Setting
// state from the ref callback makes attaching the DOM node itself the
// signal to (re-)run the effect.
export function useFitScale({
  minScale = 0.4,
  maxScale = 2.5,
}: UseFitScaleOptions = {}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  // The content width to render at (before the transform above shrinks/grows
  // it back down to `scale`), distinct from content's own natural/intrinsic
  // width. When one axis is the binding constraint (say content is
  // relatively taller than the container, so scale ends up height-bound),
  // sizing the unscaled content to exactly `naturalWidth` leaves dead space
  // on the non-binding axis once scaled - the rendered width comes out
  // smaller than the container. Solving for the width that, once multiplied
  // by `scale`, exactly equals the container's width instead lets whatever
  // flexible content is inside (e.g. a grid's columns, or a flex cell inside
  // a row) stretch to fill it, so the binding axis still determines
  // font/padding size but no width goes unused. Null until first measured.
  const [contentWidth, setContentWidth] = useState<number | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    setContent(node);
  }, []);

  useEffect(() => {
    if (!container || !content) return;

    const recompute = () => {
      const containerRect = container.getBoundingClientRect();
      const naturalWidth = content.scrollWidth;
      const naturalHeight = content.scrollHeight;
      if (naturalWidth === 0 || naturalHeight === 0) return;
      const fitScale = Math.min(
        containerRect.width / naturalWidth,
        containerRect.height / naturalHeight,
      );
      const clampedScale = Math.min(maxScale, Math.max(minScale, fitScale));
      setScale((prev) => (prev === clampedScale ? prev : clampedScale));
      const stretchedWidth = containerRect.width / clampedScale;
      setContentWidth((prev) =>
        prev !== null && Math.abs(prev - stretchedWidth) < 0.5
          ? prev
          : stretchedWidth,
      );
    };

    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [container, content, minScale, maxScale]);

  return { containerRef, contentRef, scale, contentWidth };
}
