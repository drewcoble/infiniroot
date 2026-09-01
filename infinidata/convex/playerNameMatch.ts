// Shared by external-platform linking jobs (currently just convex/espn/
// rankings.ts's name-match fallback) that need to pair an external source's
// player name against ours despite each source formatting punctuation,
// suffixes, and accents differently (e.g. ESPN's "Ja'Marr Chase" vs a source
// that might render it "Jamarr Chase"). Applying this to both sides before
// comparing is what makes them equal - it is NOT a general display formatter.
const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
// Combining diacritical marks (U+0300-U+036F) left behind by NFD
// normalization once the base letter and its accent are split apart.
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

export function normalizePlayerName(name: string): string {
  const stripped = name
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS, "") // strip accents (e.g. the accent off e-acute)
    .replace(/[^a-z0-9\s]/g, " "); // punctuation (periods/apostrophes/hyphens) -> space

  const parts = stripped.split(/\s+/).filter(Boolean);
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    if (last === undefined || !NAME_SUFFIXES.has(last)) break;
    parts.pop();
  }

  return parts.join(" ");
}
