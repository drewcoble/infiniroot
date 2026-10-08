// TEMPORARY - scoreboard-font comparison for the Cards tab's switcher. Remove
// this file, its main.tsx call, the unused Lumen @font-face rules/files, and
// the switcher once a version is picked (then hardcode it in index.css's
// --font-scoreboard / --font-scoreboard-weight).
//
// Each option sets those two variables on <html> (read by the Matchup and
// Team headers' scores) and is remembered on this device, so the choice
// holds across tabs and reloads while comparing.

export const SCOREBOARD_FONTS = [
  { id: "round900", label: "Lumen Round · Bold", family: '"Lumen Round"', weight: 900 },
  { id: "round400", label: "Lumen Round · Regular", family: '"Lumen Round"', weight: 400 },
  { id: "square900", label: "Lumen Square · Bold", family: '"Lumen Square"', weight: 900 },
  { id: "square400", label: "Lumen Square · Regular", family: '"Lumen Square"', weight: 400 },
] as const;

export type ScoreboardFontId = (typeof SCOREBOARD_FONTS)[number]["id"];

const STORAGE_KEY = "infinileague:scoreboardFont";

export function getScoreboardFont(): ScoreboardFontId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return SCOREBOARD_FONTS.some((font) => font.id === saved)
    ? (saved as ScoreboardFontId)
    : "round900";
}

export function applyScoreboardFont(id: ScoreboardFontId) {
  const font = SCOREBOARD_FONTS.find((option) => option.id === id) ?? SCOREBOARD_FONTS[0];
  const root = document.documentElement.style;
  root.setProperty("--font-scoreboard", `${font.family}, var(--font-numeric)`);
  root.setProperty("--font-scoreboard-weight", String(font.weight));
  localStorage.setItem(STORAGE_KEY, id);
}
