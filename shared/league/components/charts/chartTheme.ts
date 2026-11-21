// Colors for the simple-mode charts (components/charts/). Categorical
// slots are the dataviz reference palette's dark-mode steps, validated
// against the glass card's effective surface (~#222326) - colorblind
// separation, lightness band, and 3:1 contrast all pass for the three
// slots used here. Assign them in this order, never cycled: a chart's
// first series is SERIES[0], its second SERIES[1], and so on.
export const SERIES = ["#3987e5", "#d95926", "#199e70"] as const;

// Signed values (gains vs. losses, rank moves): blue <-> red, the
// reference palette's diverging pair - warm/cool poles that read as
// opposite. Zero sits on a neutral line, never a hue.
export const POSITIVE = "#3987e5";
export const NEGATIVE = "#e66767";

// Status colors mean good/bad and are never reused for a series - each
// ships with a text label beside it, never color alone.
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
} as const;

// A single series that isn't one of several (weekly points) - the same
// light gray as the matchup cards' points meter, so "points" reads the same
// everywhere.
export const NEUTRAL_MARK = "#9ca3af";

// Text tokens - chart text never wears a series color.
export const TEXT = {
  primary: "#f8fafc",
  secondary: "rgba(248, 250, 252, 0.65)",
  muted: "rgba(248, 250, 252, 0.42)",
} as const;

// Hairline grid/axes, one step off the glass surface.
export const GRID = "rgba(255, 255, 255, 0.1)";

// Approximate glass card surface - the 2px ring around dots that cross a
// line is drawn in this so it reads as a gap.
export const SURFACE = "#222326";
