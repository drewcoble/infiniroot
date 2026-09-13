// Plain-value design tokens, extracted out of shared/theme.ts's Mantine
// `createTheme()` call so a future native (React Native) styling layer can
// consume the exact same brand/position colors without pulling in Mantine
// itself - Mantine renders real DOM and has no React Native renderer, so
// theme.ts (and everything else in shared/) stays web-only, but the raw
// hex values underneath it are plain data with nothing web-specific about
// them. shared/theme.ts imports these rather than defining them inline;
// nothing about the actual app-facing colors changes.

// Base color "saddlebrown" (#8b4513), pinned to shade 7 rather than the
// darkest shade (@mantine/colors-generator's default placement, since
// #8b4513 registers as one of its darkest predefined lightness stops) -
// shades 8-9 are hand-extrapolated further down the same hue/saturation
// curve past #8b4513 so the scale still has two shades darker than the
// pure color available. AppHeader/NominationPanel/MobileNomination/
// BudgetTab/draftRecommendation all use this directly as the "gold glow"-
// style accent - not used for any Position/roster-slot color, so it stays
// free to experiment with independent of the position palette below.
export const saddlebrown = [
  "#edc9af",
  "#e7aa7f",
  "#e19057",
  "#de803e",
  "#dd7731",
  "#c46524",
  "#af591e",
  "#8b4513",
  "#6a320c",
  "#4b2307",
] as const;

// Generated via @mantine/colors-generator from the base color "burlywood"
// (#deb887), which lands at shade 3. Wired up as primaryColor - an
// experiment swapping it in for the light-green accent (default Anchor
// color, i.e. player-name links throughout every table, plus the mobile
// BottomNav's active-tab color, which mirrors primaryColor explicitly
// since Mantine's Group/Stack `c` prop doesn't read theme.primaryColor on
// its own).
export const burlywood = [
  "#fff5e5",
  "#f7e9d6",
  "#ead1b0",
  "#deb887",
  "#d3a262",
  "#cd944b",
  "#ca8d3e",
  "#b2792f",
  "#9f6b27",
  "#8b5c1b",
] as const;

// Generated via @mantine/colors-generator from the visual system's base
// colors: indigo #33397A, gold #C9A24E, green #3E7856, red #B4543F - each
// lands as the darkest shade (index 9), same convention as saddlebrown
// above.
export const indigo = [
  "#f1f1f9",
  "#dee0ec",
  "#babdda",
  "#9498c9",
  "#7479ba",
  "#6065b2",
  "#565baf",
  "#464b9a",
  "#3e438a",
  "#33397a",
] as const;

export const gold = [
  "#fff6e4",
  "#f6ecd5",
  "#e9d7b0",
  "#dbc187",
  "#d0ae65",
  "#c9a24e",
  "#c69c41",
  "#ae8732",
  "#9c7829",
  "#87671c",
] as const;

export const green = [
  "#f2f8f4",
  "#e4ede8",
  "#c5dbce",
  "#a2c8b1",
  "#85b899",
  "#72ae8a",
  "#67a981",
  "#56946f",
  "#4a8461",
  "#3e7856",
] as const;

export const red = [
  "#ffefeb",
  "#f6dfda",
  "#e5beb5",
  "#d69a8d",
  "#c97c6b",
  "#c16955",
  "#be5f4a",
  "#b4543f",
  "#974533",
  "#853929",
] as const;

// Position-specific palette, generated via @mantine/colors-generator from
// one base hex per Position/roster-slot (see positionColors.ts, the
// consumer that maps each Position to one of these).
export const qb = [
  "#fff7e2",
  "#fceecf",
  "#f5dca3",
  "#efc873",
  "#eab84b",
  "#e8b23d",
  "#e5a821",
  "#cb9212",
  "#b58208",
  "#9d6f00",
] as const;

export const superflex = [
  "#fff4e9",
  "#f6e7d9",
  "#e9cdb2",
  "#deb187",
  "#d49963",
  "#ce8a4b",
  "#cc833e",
  "#b47030",
  "#a8672a",
  "#8d541d",
] as const;

export const rb = [
  "#e8fbf1",
  "#dbf1e5",
  "#b9e0cb",
  "#95cfb0",
  "#76c098",
  "#62b789",
  "#4fae7b",
  "#459c6e",
  "#398b60",
  "#297951",
] as const;

export const flex = [
  "#e3fcff",
  "#d5f2f7",
  "#afe3ea",
  "#86d2dd",
  "#65c5d2",
  "#4fbccc",
  "#3fb8c9",
  "#2ca2b2",
  "#1a909f",
  "#007d8c",
] as const;

export const wr = [
  "#e6f4ff",
  "#d1e5ff",
  "#a5c7f6",
  "#75a8ee",
  "#4f8fe8",
  "#337de4",
  "#2275e4",
  "#1063cb",
  "#0058b7",
  "#004ca3",
] as const;

export const te = [
  "#fbecff",
  "#eed7fa",
  "#d8adef",
  "#c280e4",
  "#b15fdb",
  "#a342d5",
  "#9d36d3",
  "#8928bb",
  "#7a22a8",
  "#6b1994",
] as const;

export const k = [
  "#ffebf8",
  "#fad7e8",
  "#eeaecd",
  "#e282b0",
  "#d9639c",
  "#d24589",
  "#d03882",
  "#b8296f",
  "#a52163",
  "#921556",
] as const;

export const dst = [
  "#fbf0ee",
  "#f0dddb",
  "#e5b8b2",
  "#da8f86",
  "#d16e61",
  "#cd5949",
  "#cb4d3d",
  "#b33f2f",
  "#a03729",
  "#7c271d",
] as const;

export const bn = [
  "#f0f5fe",
  "#e4e7ec",
  "#c9ccd2",
  "#abafb7",
  "#9397a1",
  "#828893",
  "#7a808e",
  "#6b7280",
  "#5a6270",
  "#4b5465",
] as const;

// Provider brand colors, generated via @mantine/colors-generator the same
// way as the palette above - Sleeper's dark navy blue (base #1F2A44, lands
// at shade 9) and Yahoo's purple (base #6001D2, lands at shade 8). Eyeballed
// from each provider's own branding rather than an official brand kit, so
// nudge the base hex above and regenerate if either reads off. Used only on
// LeagueCreateChoice.tsx's "Import from Sleeper"/"Import from Yahoo"
// buttons - not wired into positionColors.ts or anything provider-neutral.
export const sleeper = [
  "#f1f3f9",
  "#e1e4eb",
  "#bec6d8",
  "#99a6c6",
  "#7b8bb6",
  "#677aad",
  "#5c72aa",
  "#4c6095",
  "#435686",
  "#1f2a44",
] as const;

export const yahoo = [
  "#f5eaff",
  "#e5d0ff",
  "#c89dfc",
  "#aa66fb",
  "#9139fa",
  "#811efa",
  "#7911fb",
  "#6805e0",
  "#6001d2",
  "#4e00b0",
] as const;

// Dark-mode surface retint - a very dark, desaturated forest green instead
// of a plain blue-black ink or Mantine's neutral gray dark palette. Only
// shades 6-9 (the ones Mantine actually uses for body/card/border/hover
// backgrounds) are replaced; 0-5 are left as Mantine's defaults since those
// are tuned for text/dimmed-text contrast rather than brand color - so this
// array is deliberately a partial override, not a full 10-shade scale like
// the palettes above.
export const darkSurfaces = [
  "#C1C2C5",
  "#A6A7AB",
  "#909296",
  "#5C5F66",
  "#373A40",
  "#2C2E33",
  "#121B17", // soft - borders, hover surfaces
  "#0C1310", // body background
  "#090F0D",
  "#060A08",
] as const;

// Paper (#F5F4EF) is the light-mode surface; ink (#12161C) rides along as
// the light-mode text color via Mantine's --mantine-color-black variable.
export const paper = "#F5F4EF";
export const ink = "#12161C";

export const PRIMARY_COLOR_NAME = "burlywood";

// Mantine's own default ("md", 8px) reads a little square/sharp-cornered
// app-wide (buttons especially) - 12px softens every component that
// doesn't set its own explicit radius.
export const DEFAULT_RADIUS = "12px";
