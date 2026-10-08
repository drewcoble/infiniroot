// TEMPORARY - badge-font comparison for the Cards tab's switcher. Remove
// this file, its main.tsx call, the unused @fontsource imports/packages,
// and the switcher once a font is picked (then hardcode it in index.css's
// --font-badge / --font-badge-weight).
//
// Each option sets those two variables on <html> - read by the glass
// badges (.pill) and position filter chips - and is remembered on this
// device, so the choice holds across tabs and reloads while comparing.

export const BADGE_FONTS = [
  { id: "barlow", label: "Barlow (current)", family: '"Barlow"', weight: 700 },
  { id: "plex", label: "IBM Plex Mono", family: '"IBM Plex Mono"', weight: 600 },
  { id: "jetbrains", label: "JetBrains Mono", family: '"JetBrains Mono"', weight: 700 },
  { id: "roboto", label: "Roboto Mono", family: '"Roboto Mono"', weight: 600 },
  { id: "redHat", label: "Red Hat Mono", family: '"Red Hat Mono"', weight: 600 },
  { id: "dm", label: "DM Mono", family: '"DM Mono"', weight: 500 },
] as const;

export type BadgeFontId = (typeof BADGE_FONTS)[number]["id"];

const STORAGE_KEY = "infinileague:badgeFont";

export function getBadgeFont(): BadgeFontId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return BADGE_FONTS.some((font) => font.id === saved) ? (saved as BadgeFontId) : "barlow";
}

export function applyBadgeFont(id: BadgeFontId) {
  const font = BADGE_FONTS.find((option) => option.id === id) ?? BADGE_FONTS[0];
  const root = document.documentElement.style;
  root.setProperty("--font-badge", `${font.family}, var(--app-font-body)`);
  root.setProperty("--font-badge-weight", String(font.weight));
  localStorage.setItem(STORAGE_KEY, id);
}
