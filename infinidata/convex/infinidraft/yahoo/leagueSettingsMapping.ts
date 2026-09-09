import { POSITIONS } from "../../positions";
import type { Scoring, TeScoring } from "../../scoring";
import { findNodesByKey, mergeYahooFields } from "./client";

type Position = (typeof POSITIONS)[number];

export interface MappedRosterSlots {
  rosterSlots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    DST: number;
    K: number;
    FLEX: number;
    SUPERFLEX: number;
    BENCH: number;
  };
  // infinidraft's flex/superflex eligibility is league-wide, not per-slot - same
  // simplification convex/sleeper/leagueSettingsMapping.ts makes.
  flexPositions: Position[];
  superflexPositions: Position[];
  // Roster position codes Yahoo returned that have no equivalent slot in
  // this app's model (e.g. "IR") - surfaced so the import preview UI can
  // tell the user their real roster is larger than what got imported.
  droppedSlots: string[];
}

// Yahoo's roster_positions entries are {position, position_type, count} -
// unlike Sleeper's flat repeated-code array, one entry already covers every
// slot of that type. Codes below are from general knowledge of Yahoo's
// Fantasy Football roster position codes, NOT a confirmed live response -
// see YAHOO.md's "Things to verify" list. W/R/T and Q/W/R/T are Yahoo's
// standard FLEX/SUPERFLEX-equivalent codes; some leagues may use narrower
// flex codes (e.g. W/T) which are folded into FLEX the same
// simplified way Sleeper's WRRB_FLEX/REC_FLEX are.
const SLOT_CODE_MAP: Record<
  string,
  keyof MappedRosterSlots["rosterSlots"] | "FLEX" | "SUPERFLEX"
> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  K: "K",
  "W/R/T": "FLEX",
  "W/T": "FLEX",
  "R/W": "FLEX",
  "Q/W/R/T": "SUPERFLEX",
  BN: "BENCH",
};

// Position codes that exist in Yahoo rosters but aren't a real bench/starter
// slot in infinidraft's model - dropped (not counted as BENCH) rather than
// silently mapped, since IR doesn't cost a real roster spot in most leagues.
const IGNORED_SLOT_CODES = new Set(["IR", "IR+"]);

// Reads a league's roster_positions straight out of the raw settings JSON
// tree (see convex/infinidraft/yahoo/client.ts's mergeYahooFields/findNodesByKey for why
// this searches rather than assumes one exact path).
export function mapYahooRosterPositions(settingsNode: unknown): MappedRosterSlots {
  const rosterPositionsRoot = findNodesByKey(settingsNode, "roster_positions");
  const positionEntries = findNodesByKey(rosterPositionsRoot, "roster_position").map(
    mergeYahooFields,
  );

  const rosterSlots: MappedRosterSlots["rosterSlots"] = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    DST: 0,
    K: 0,
    FLEX: 0,
    SUPERFLEX: 0,
    BENCH: 0,
  };
  const droppedSlots = new Set<string>();

  for (const entry of positionEntries) {
    const code = typeof entry.position === "string" ? entry.position : "";
    const count = Number(entry.count) || 0;
    if (!code || count <= 0) continue;
    if (IGNORED_SLOT_CODES.has(code)) continue;
    const mapped = SLOT_CODE_MAP[code];
    if (!mapped) {
      droppedSlots.add(code);
      continue;
    }
    rosterSlots[mapped] += count;
  }

  return {
    rosterSlots,
    flexPositions: rosterSlots.FLEX > 0 ? ["RB", "WR", "TE"] : [],
    superflexPositions:
      rosterSlots.SUPERFLEX > 0 ? ["QB", "RB", "WR", "TE"] : [],
    droppedSlots: [...droppedSlots],
  };
}

// Yahoo's `uses_faab` settings field (0/1, seen elsewhere as "1"/true too -
// same defensive truthy check convex/infinidraft/yahoo/league.ts's
// is_owned_by_current_login uses) - whether this league uses FAAB waivers
// vs. rolling waiver priority order, read the same find-anywhere-in-the-tree
// way roster_positions/stat_categories above are, since it's not confirmed
// which exact depth it lands at. NOT confirmed against a live response -
// see YAHOO.md. Doesn't attempt to read a league-wide FAAB budget amount -
// no confirmed Yahoo field for that; convex/infinidraft/yahoo/league.ts's
// syncYahooLeagueRoster leaves seasons.faabBudget for the commissioner to
// set manually in Season Settings, same as every other league.
export function mapYahooWaiverType(settingsNode: unknown): "faab" | "priority" {
  const usesFaab = findNodesByKey(settingsNode, "uses_faab")[0];
  return usesFaab === 1 || usesFaab === "1" || usesFaab === true
    ? "faab"
    : "priority";
}

// Shared two-step lookup every Yahoo scoring signal below needs:
// stat_categories gives each stat a stat_id + name, but the actual point
// VALUE lives in the separate stat_modifiers list, keyed by that same
// stat_id - both nested under the same league settings resource. Finds
// every stat_categories entry whose name/display_name matches (a league can
// define more than one stat with a matching name, e.g. a general "Reception"
// and a position-scoped one - see mapYahooTeScoring below), then returns the
// first matching stat_modifiers value found. undefined means no matching
// stat category was found at all (wrong name guess, or - for a niche
// setting like TE premium - this league genuinely doesn't have one).
// Unverified against a live response - see YAHOO.md.
function findYahooStatModifierValue(
  settingsNode: unknown,
  matchesName: (name: string) => boolean,
): number | undefined {
  const statCategoriesRoot = findNodesByKey(settingsNode, "stat_categories");
  const statIds = new Set(
    findNodesByKey(statCategoriesRoot, "stat")
      .map(mergeYahooFields)
      .filter((stat) =>
        matchesName(String(stat.name ?? stat.display_name ?? "").toLowerCase()),
      )
      .map((stat) => String(stat.stat_id)),
  );
  if (statIds.size === 0) return undefined;

  const statModifiersRoot = findNodesByKey(settingsNode, "stat_modifiers");
  for (const modifier of findNodesByKey(statModifiersRoot, "stat").map(mergeYahooFields)) {
    if (statIds.has(String(modifier.stat_id))) {
      return Number(modifier.value) || 0;
    }
  }
  return undefined;
}

// Nearest-bucket match against infinidraft's fixed STD/HALF/PPR trio, mirroring
// convex/sleeper/leagueSettingsMapping.ts's mapScoringSettings. Yahoo has no
// single "rec" field the way Sleeper's scoring_settings does - see
// findYahooStatModifierValue above for the two-step lookup this needs.
// Unverified against a live response - see YAHOO.md.
export function mapYahooScoringSettings(settingsNode: unknown): Scoring {
  const recValue =
    findYahooStatModifierValue(
      settingsNode,
      (name) => name.includes("reception") || name === "rec",
    ) ?? 0;
  if (recValue >= 0.75) return "PPR";
  if (recValue >= 0.25) return "HALF";
  return "STD";
}

// Passing-TD point value - same two-step lookup as reception scoring above,
// matching Yahoo's standard stat label ("Passing Touchdowns"). >=5 is
// treated as a 6pt-equivalent league (real leagues use exactly 4 or 6; this
// tolerates an unusual in-between value on the higher side rather than
// requiring an exact match). Defaults to false (4pt, the far more common
// setting) if no matching stat category is found at all - every real Yahoo
// league has SOME passing-TD stat, so unlike TE premium below, a miss here
// means the name guess is wrong, not that the setting doesn't apply; logs
// the raw settings tree so that's visible rather than silently importing
// every league as 4pt. Unverified against a live response - see YAHOO.md.
export function mapYahooSixPointPassTds(settingsNode: unknown): boolean {
  const value = findYahooStatModifierValue(
    settingsNode,
    (name) => name.includes("passing touchdown") || name.includes("pass touchdown"),
  );
  if (value === undefined) {
    // Diagnostic for an unconfirmed shape - remove once checked against a
    // real response and this stops happening.
    console.error(
      "mapYahooSixPointPassTds: no passing-TD stat category found, raw settings:",
      JSON.stringify(settingsNode),
    );
    return false;
  }
  return value >= 5;
}

// TE-premium detection - considerably less confident than the two lookups
// above. Sleeper models this as a flat bonus-per-reception layered on top of
// the league's normal PPR value (bonus_rec_te); Yahoo has no confirmed
// equivalent single field. Working theory (unverified, see YAHOO.md): a
// TE-premium Yahoo league defines a SEPARATE, position-scoped "Reception"
// stat category just for tight ends (its own stat_id, distinct from the
// general reception category mapYahooScoringSettings reads above), rather
// than a bonus layered on the same stat - matches a stat category whose
// name mentions both reception and TE/tight end, then buckets the
// DIFFERENCE between its value and the general reception value the same way
// mapYahooScoringSettings buckets the raw PPR value. No matching category
// found at all -> NONE, without logging - a true negative is the expected/
// correct result for the large majority of leagues that don't use TE
// premium (unlike sixPointPassTds, where every league has SOME passing-TD
// stat to find, so a miss there is a real signal something's wrong).
export function mapYahooTeScoring(settingsNode: unknown): TeScoring {
  const teRecValue = findYahooStatModifierValue(
    settingsNode,
    (name) =>
      (name.includes("reception") || name.includes(" rec")) &&
      (name.includes("te") || name.includes("tight end")),
  );
  if (teRecValue === undefined) return "NONE";
  const generalRecValue =
    findYahooStatModifierValue(
      settingsNode,
      (name) => name.includes("reception") || name === "rec",
    ) ?? 0;
  const bonus = teRecValue - generalRecValue;
  if (bonus >= 0.75) return "FULL";
  if (bonus >= 0.25) return "HALF";
  return "NONE";
}
