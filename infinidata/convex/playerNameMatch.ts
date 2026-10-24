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

// Fallbacks for when name + position doesn't match, both scoped to the
// player's NFL team and used only when exactly one candidate has the key:
// 1. Same name, different position - providers disagree on some players
//    (ESPN lists Velus Jones Jr. at RB, Sleeper at WR).
// 2. Same last name + position, for nicknames (Yahoo/ESPN's "Bam Knight" is
//    Sleeper's "Zonovan Knight"). Skipped for a name we already have under
//    any team or position - that's a different player who just isn't a
//    candidate here, not a nickname.
// `isCandidate` narrows which players can be matched (e.g. not already
// linked elsewhere) without dropping them from that already-have check.
export function nameTeamMatchKey(name: string, team: string): string {
  return `${normalizePlayerName(name)}|${team}`;
}

export function lastNameMatchKey(name: string, position: string, team: string): string {
  const normalized = normalizePlayerName(name);
  const lastName = normalized.slice(normalized.lastIndexOf(" ") + 1);
  return `${lastName}|${position}|${team}`;
}

type MatchablePlayer = { fpid: number; name: string; position: string; team: string | null };

export function createFallbackMatcher<P extends MatchablePlayer>(
  players: P[],
  isCandidate: (player: P) => boolean = () => true,
): (name: string, position: string, team: string) => number | undefined {
  const knownNames = new Set(players.map((player) => normalizePlayerName(player.name)));
  // null marks a collision - two or more candidates share the key.
  const byNameTeam = new Map<string, number | null>();
  const byLastName = new Map<string, number | null>();
  const add = (index: Map<string, number | null>, key: string, fpid: number) =>
    index.set(key, index.has(key) ? null : fpid);
  for (const player of players) {
    if (!player.team || !isCandidate(player)) continue;
    add(byNameTeam, nameTeamMatchKey(player.name, player.team), player.fpid);
    add(byLastName, lastNameMatchKey(player.name, player.position, player.team), player.fpid);
  }
  return (name, position, team) => {
    const sameName = byNameTeam.get(nameTeamMatchKey(name, team));
    if (sameName !== undefined) return sameName ?? undefined;
    if (knownNames.has(normalizePlayerName(name))) return undefined;
    return byLastName.get(lastNameMatchKey(name, position, team)) ?? undefined;
  };
}
