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
