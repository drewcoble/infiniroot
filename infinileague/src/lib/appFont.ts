// TEMPORARY - app text-font comparison for the Cards tab's switcher. Remove
// this file, its main.tsx call, the unused @fontsource imports/packages,
// and the switcher once a pairing is picked (then hardcode it in
// index.css's --app-font-* defaults).
//
// infinileague's theme (main.tsx) points Mantine's body and heading fonts
// at index.css's --app-font-body / --app-font-heading / --app-heading-weight;
// each option sets those on <html> and is remembered on this device, so
// the choice holds across tabs and reloads while comparing.

export const APP_FONTS = [
  {
    id: "barlow",
    label: "A · All Barlow",
    body: '"Barlow"',
    heading: '"Barlow"',
    headingWeight: 600,
  },
  {
    id: "publicSans",
    label: "B · Public Sans + Barlow",
    body: '"Public Sans"',
    heading: '"Barlow"',
    headingWeight: 600,
  },
  {
    id: "sourceSans",
    label: "C · Source Sans 3 + Barlow",
    body: '"Source Sans 3"',
    heading: '"Barlow"',
    headingWeight: 600,
  },
  {
    id: "redHat",
    label: "D · Red Hat",
    body: '"Red Hat Text"',
    heading: '"Red Hat Display"',
    headingWeight: 700,
  },
  {
    id: "current",
    label: "Current · Inter + Space Grotesk",
    body: "Inter",
    heading: '"Space Grotesk"',
    headingWeight: 700,
  },
] as const;

export type AppFontId = (typeof APP_FONTS)[number]["id"];

const STORAGE_KEY = "infinileague:appFont";

export function getAppFont(): AppFontId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return APP_FONTS.some((font) => font.id === saved) ? (saved as AppFontId) : "current";
}

export function applyAppFont(id: AppFontId) {
  const font = APP_FONTS.find((option) => option.id === id) ?? APP_FONTS[APP_FONTS.length - 1]!;
  const root = document.documentElement.style;
  root.setProperty("--app-font-body", `${font.body}, sans-serif`);
  root.setProperty("--app-font-heading", `${font.heading}, sans-serif`);
  root.setProperty("--app-heading-weight", String(font.headingWeight));
  localStorage.setItem(STORAGE_KEY, id);
}
