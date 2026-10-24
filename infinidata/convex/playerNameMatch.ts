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

// Fallback for when full names disagree because one side uses a nickname
// (Yahoo/ESPN's "Bam Knight" is Sleeper's "Zonovan Knight"): last name +
// position + NFL team. Matches only when exactly one of `players` has that
// key, and never for a name we already know at some other position (ESPN
// lists Velus Jones Jr. at RB, Sleeper at WR - he'd otherwise land on
// teammate Justin Jones).
export function lastNameMatchKey(name: string, position: string, team: string): string {
  const normalized = normalizePlayerName(name);
  const lastName = normalized.slice(normalized.lastIndexOf(" ") + 1);
  return `${lastName}|${position}|${team}`;
}

export function createLastNameMatcher(
  players: Array<{ fpid: number; name: string; position: string; team: string | null }>,
): (name: string, position: string, team: string) => number | undefined {
  const knownNames = new Set(players.map((player) => normalizePlayerName(player.name)));
  // null marks a collision - two or more players share the key.
  const byKey = new Map<string, number | null>();
  for (const player of players) {
    if (!player.team) continue;
    const key = lastNameMatchKey(player.name, player.position, player.team);
    byKey.set(key, byKey.has(key) ? null : player.fpid);
  }
  return (name, position, team) => {
    if (knownNames.has(normalizePlayerName(name))) return undefined;
    return byKey.get(lastNameMatchKey(name, position, team)) ?? undefined;
  };
}
