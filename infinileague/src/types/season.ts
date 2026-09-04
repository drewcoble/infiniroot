// Minimal shape infinileague actually reads off api.leagues.listLinkedSeasons
// - the generated src/convexApi.ts's return type is untyped (`any`), since
// none of infinidraft's Convex functions declare an explicit `returns`
// validator (see that file's own header comment) - this is the "define a
// local interface for the shape you actually consume" case it points to.
// leagueId/year drive groupSeasonsByLeague; the rest is what the dashboard
// card / header picker / league page display.
export interface LinkedSeason {
  _id: string;
  leagueId: string;
  year: string;
  name: string;
  teamCount: number;
  scoring: "STD" | "HALF" | "PPR";
  // Absent until the season's first roster sync runs (see
  // api.sleeper.league.syncLeagueRoster) - determines which column the
  // standings table shows (see StandingsRow below).
  waiverType?: "faab" | "priority";
}

// Mirrors convex/season/standings.ts's StandingsRow - already sorted by the
// backend (win% desc, pointsFor desc tiebreak), rank already assigned.
// Exactly one of faabRemaining/waiverPosition is set, chosen by the
// season's waiverType above.
export interface StandingsRow {
  teamId: string;
  name: string;
  isSelf: boolean;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  faabRemaining?: number;
  waiverPosition?: number;
}

// Mirrors convex/infinileague/season/powerRankings.ts's PowerRankingRow -
// already ranked descending by the backend (each team's optimal-lineup
// total, current week through week 18), so this just renders in the order
// given, same convention as StandingsRow above.
export interface PowerRankingRow {
  teamId: string;
  name: string;
  isSelf: boolean;
  totalProjectedPoints: number;
  // Rank this week minus rank last snapshotted week - positive means moved
  // up, negative means moved down. Absent when there's no prior snapshot
  // yet (first computation for this season).
  rankChange?: number;
}

// Mirrors convex/lib/faab.ts's FaabSuggestionRow/FaabSuggestionsResult -
// consumed via convex/infinileague/season/faabValues.ts's getFaabSuggestions.
// suggestions is unsorted (ranked per-position by rosValue, not globally) -
// the Free Agents tab sorts it for display.
export interface FaabSuggestionRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosValue: number;
  positionRank: number;
  // Same VOR concept the pre-draft value process uses - rosValue above this
  // position's replacement level among currently-available free agents.
  // Genuinely unclamped (can go negative) - a ranking/tiebreak signal, not
  // a dollar amount.
  valueOverReplacement: number;
  // Demand across the whole league, not just the viewer - how many teams
  // have a real roster gap this player would fill, and the single largest
  // gap among them. 0/0 means nobody actually needs this player right now.
  demandCount: number;
  topDemandValue: number;
  // myValue/suggestedBid/rationale are only populated when the query was
  // called with a teamId - null otherwise (see FreeAgentsTab, which always
  // passes the viewer's own team once known). Priced against THAT team's
  // own value/budget, never a share of the league's combined FAAB.
  myValue: number | null;
  suggestedBid: number | null;
  rationale: string | null;
  // Set when this player's value includes a time-boxed bump from plausibly
  // inheriting a just-injured teammate's workload.
  boostReason: string | null;
}

export interface FaabSuggestionsResult {
  // Both null outside the NFL regular season (see convex/lib/faab.ts) - no
  // free-agent market to suggest bids against pre-season/post-season.
  week: string | null;
  season: string | null;
  remainingWeeks: number;
  suggestions: FaabSuggestionRow[];
}

// Mirrors convex/rosVor.ts's RosVorRow - already sorted by the backend
// (rosRank ascending), so the Players tab just renders in the order given
// unless the viewer's swapped the sort. rosRank is the UI-facing int (1 =
// best, global across every position) - raw rosVor/actualVor stay unused
// here, per the product call that only the rank should ever be shown.
export interface RosVorRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosVor: number;
  rosRank: number;
  actualVor: number;
  actualRank: number;
  // This player's rank among just their own position (1 = the best RB,
  // best WR, etc.) - "RB1"/"TE16" style labels, same rosVor ordering
  // rosRank uses globally.
  positionRank: number;
  // Display-facing per-game rates - rosPpg is the momentum-adjusted
  // rest-of-season rate (rosValue / remaining weeks), actualPpg is this
  // season's real average so far.
  rosPpg: number;
  actualPpg: number;
  rosteredByTeamName: string | null;
  // Absent means not currently injured - mirrors TeamRosterRow's injury
  // field below, same convex/injuries.ts source (Sleeper-derived).
  injury?: { status: string; statusShort: string };
}

export type SlotLabel =
  | "QB"
  | "SUPERFLEX"
  | "RB"
  | "WR"
  | "FLEX"
  | "TE"
  | "DST"
  | "K"
  | "BENCH"
  | "IR"
  | "TAXI";

// Mirrors convex/season/teamRoster.ts's TeamRosterRow - already sorted by
// the backend in infinidraft's own canonical slot order (QB, SUPERFLEX, RB,
// WR, FLEX, TE, DST, K, BENCH, IR, TAXI - see src/lib/rosterSlots.ts's
// SLOT_ORDER there), so this just renders in the order given. slot/
// actualPoints are only ever absent when the team isn't Sleeper-linked;
// projectedPoints is absent whenever that week hasn't been projected yet.
// Every other field (fpid, name, position, ...) is absent together for an
// unfilled roster slot - an open starter/bench/taxi spot the league is
// configured for but hasn't had a player assigned to yet - rather than
// that slot just not appearing as a row at all.
export interface TeamRosterRow {
  fpid?: number;
  name?: string;
  position?: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  team?: string | null;
  byeWeek?: number;
  isRookie?: boolean;
  injury?: { status: string; statusShort: string };
  slot?: SlotLabel;
  actualPoints?: number;
  projectedPoints?: number;
}
