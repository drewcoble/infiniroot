// "Christian McCaffrey" -> "C. McCaffrey" for cards too narrow for full
// names, with a collision guard: if two players in the pool would read
// alike once shortened, both keep their full first names instead
// ("Bijan Robinson" / "Brian Robinson Jr." rather than two "B. Robinson"s).
//
// "Read alike" ignores generational suffixes - "B. Robinson" and
// "B. Robinson Jr." are technically different strings but still easy to
// mix up at a glance, so they count as a collision too.

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

function normalize(token: string): string {
  return token.toLowerCase().replace(/\./g, "");
}

interface ParsedName {
  first: string;
  rest: string;
  // Initial + last name with suffixes dropped - two names sharing a key
  // would look alike once shortened.
  key: string;
}

function parse(fullName: string): ParsedName | null {
  const tokens = fullName.trim().split(/\s+/);
  // Single-token names (team defenses, mononyms) have nothing to shorten.
  if (tokens.length < 2) return null;
  const [first, ...restTokens] = tokens;
  const lastTokens = restTokens.filter((token) => !SUFFIXES.has(normalize(token)));
  return {
    first: first!,
    rest: restTokens.join(" "),
    key: `${normalize(first!)[0]}|${lastTokens.map(normalize).join(" ")}`,
  };
}

function abbreviate(parsed: ParsedName): string {
  // First names already written as initials ("D.J.", "A.J.") are as short
  // as they get - cutting "D.J." to "D." would only lose information.
  if (parsed.first.includes(".")) return `${parsed.first} ${parsed.rest}`;
  return `${parsed.first[0]}. ${parsed.rest}`;
}

// `pool` should be every player a viewer could mistake this one for - the
// whole league-relevant player set, not just the cards on screen, since
// "B. Robinson" is ambiguous even when only one of them is showing.
export function buildShortNames(pool: Iterable<string>): (fullName: string) => string {
  const namesByKey = new Map<string, Set<string>>();
  for (const name of pool) {
    const parsed = parse(name);
    if (!parsed) continue;
    const names = namesByKey.get(parsed.key) ?? new Set<string>();
    names.add(name.trim());
    namesByKey.set(parsed.key, names);
  }
  return (fullName) => {
    const parsed = parse(fullName);
    if (!parsed) return fullName;
    const collides = (namesByKey.get(parsed.key)?.size ?? 0) > 1;
    return collides ? fullName : abbreviate(parsed);
  };
}
