// TEMPORARY - number-font comparison for the Cards tab's switcher. Remove
// this file, its main.tsx call, the extra @fontsource imports/packages, and
// the switcher once a font is picked (then hardcode it in index.css).
//
// Each option sets index.css's --font-numeric / --font-numeric-weight on
// <html>, which every number style reads, and is remembered on this device
// so the choice holds across tabs and reloads while comparing.

export const NUMERIC_FONTS = [
  { id: "fjalla", label: "Fjalla One", family: '"Fjalla One"', weight: 400 },
  { id: "barlowSemi", label: "Barlow Semi Cond.", family: '"Barlow Semi Condensed"', weight: 600 },
  { id: "archivo", label: "Archivo", family: '"Archivo"', weight: 600 },
  { id: "barlow", label: "Barlow", family: '"Barlow"', weight: 600 },
  { id: "rubik", label: "Rubik", family: '"Rubik"', weight: 500 },
  { id: "system", label: "System (before)", family: "", weight: 700 },
] as const;

export type NumericFontId = (typeof NUMERIC_FONTS)[number]["id"];

const STORAGE_KEY = "infinileague:numericFont";

export function getNumericFont(): NumericFontId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return NUMERIC_FONTS.some((font) => font.id === saved) ? (saved as NumericFontId) : "fjalla";
}

export function applyNumericFont(id: NumericFontId) {
  const font = NUMERIC_FONTS.find((option) => option.id === id) ?? NUMERIC_FONTS[0];
  const root = document.documentElement.style;
  root.setProperty(
    "--font-numeric",
    font.family ? `${font.family}, var(--mantine-font-family)` : "var(--mantine-font-family)",
  );
  root.setProperty("--font-numeric-weight", String(font.weight));
  localStorage.setItem(STORAGE_KEY, id);
}
