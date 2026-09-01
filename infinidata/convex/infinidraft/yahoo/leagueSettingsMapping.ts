import { POSITIONS } from "../../positions";
import type { Scoring } from "../../scoring";
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

// Nearest-bucket match against infinidraft's fixed STD/HALF/PPR trio, mirroring
// convex/sleeper/leagueSettingsMapping.ts's mapScoringSettings. Yahoo has no
// single "rec" field the way Sleeper's scoring_settings does - the
// reception point value is buried in stat_modifiers, keyed by a stat_id
// that has to be resolved against stat_categories' stat name/display_name
// first (both nested under the same league settings resource). This whole
// two-step lookup is unverified against a live response - see YAHOO.md.
export function mapYahooScoringSettings(settingsNode: unknown): Scoring {
  const statCategoriesRoot = findNodesByKey(settingsNode, "stat_categories");
  const statDefs = findNodesByKey(statCategoriesRoot, "stat").map(mergeYahooFields);
  const receptionStatIds = new Set(
    statDefs
      .filter((stat) => {
        const name = String(stat.name ?? stat.display_name ?? "").toLowerCase();
        return name.includes("reception") || name === "rec";
      })
      .map((stat) => String(stat.stat_id)),
  );

  const statModifiersRoot = findNodesByKey(settingsNode, "stat_modifiers");
  const modifiers = findNodesByKey(statModifiersRoot, "stat").map(mergeYahooFields);
  let recValue = 0;
  for (const modifier of modifiers) {
    if (receptionStatIds.has(String(modifier.stat_id))) {
      recValue = Number(modifier.value) || 0;
      break;
    }
  }

  if (recValue >= 0.75) return "PPR";
  if (recValue >= 0.25) return "HALF";
  return "STD";
}
