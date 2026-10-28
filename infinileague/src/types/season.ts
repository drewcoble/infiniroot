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
  // TE premium and 6-point passing TDs (convex/scoring.ts) - absent on
  // seasons that predate them, meaning NONE / off.
  teScoring?: "NONE" | "HALF" | "FULL";
  sixPointPassTds?: boolean;
  // Absent until the season's first roster sync runs (see
  // api.sleeper.league.syncLeagueRoster) - determines which column the
  // standings table shows (see StandingsRow below).
  waiverType?: "faab" | "priority";
  // Exactly one of these is set (see convex/leagues.ts's listLinkedSeasons,
  // which only returns seasons linked to one provider or the other) - lets
  // the dashboard pick which provider's sync action to call (see
  // routes/league/$leagueId/index.tsx's runSync).
  sleeperLeagueId?: string;
  yahooLeagueKey?: string;
  espnLeagueId?: string;
  // Absent means "redraft" (see convex/leagueType.ts's resolveLeagueType) -
  // "guillotine" swaps the dashboard's Standings tab for Elimination Watch
  // (see routes/league/$leagueId/index.tsx).
  leagueType?: "redraft" | "guillotine";
}

// Mirrors convex/season/standings.ts's StandingsRow - already sorted by the
// backend (win% desc, pointsFor desc tiebreak), rank already assigned.
// Exactly one of faabRemaining/waiverPosition is set, chosen by the
// season's waiverType above.
export interface StandingsRow {
  teamId: string;
  name: string;
  // The provider's team logo/avatar - absent shows initials (TeamLogo).
  logoUrl?: string;
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

// Mirrors convex/infinileague/season/projectedStandings.ts's
// ProjectedStandingsRow - already sorted and ranked by the backend.
export interface ProjectedStandingsRow {
  teamId: string;
  name: string;
  logoUrl?: string;
  isSelf: boolean;
  rank: number;
  currentRank: number;
  // Projected rank last snapshotted week minus this week's - positive means
  // the projected finish moved up. Absent with no earlier snapshot.
  rankChange?: number;
  // Expected final record - fractional, from each remaining game's win
  // probability.
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  currentWins: number;
  currentLosses: number;
  currentTies: number;
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
  // totalProjectedPoints per remaining week - optional since a backend
  // deployed before this field existed doesn't send it.
  rosPpg?: number;
  // Rank this week minus rank last snapshotted week - positive means moved
  // up, negative means moved down. Absent when there's no prior snapshot
  // yet (first computation for this season).
  rankChange?: number;
}

// Mirrors convex/infinileague/season/matchup.ts's LeagueWeekMatchups - one
// week's pairings plus each paired team's starters and bench.
export interface LeagueWeekMatchups {
  isPlayoffWeek: boolean;
  matchups: { teamAId: string; teamBId: string; roundName?: string }[];
  lineupsByTeam: { teamId: string; rows: TeamRosterRow[] }[];
}

// Mirrors convex/infinileague/season/tournaments.ts and playoffs.ts - the
// league's playoff tournaments (just the championship for now).
export interface TournamentEntrant {
  teamId: string | null;
  seed: number | null;
  points: number | null;
  fromGameId: string | null;
}

export interface TournamentGame {
  id: string;
  entrants: [TournamentEntrant, TournamentEntrant];
  winnerTeamId: string | null;
}

export interface TournamentRound {
  round: number;
  name: string;
  weeks: number[];
  games: TournamentGame[];
}

export interface Tournament {
  kind: "championship";
  name: string;
  rounds: TournamentRound[];
  championTeamId: string | null;
}

export type SeasonPhase = "regular" | "playoffs" | "complete";

export interface LeaguePlayoffs {
  hasPlayoffs: boolean;
  regularSeasonEndWeek: number;
  playoffTeamCount: number;
  currentWeek: number;
  phase: SeasonPhase;
  tournaments: Tournament[];
}

// Mirrors convex/infinileague/season/eliminationWatch.ts's
// EliminationWatchRow - this week's set-lineup projection only (not
// rest-of-season, unlike PowerRankingRow above), already ranked descending
// (rank 1 = best/safest, same convention as every other list here) with the
// bottom slice flagged red/gold/green.
export interface EliminationWatchRow {
  teamId: string;
  name: string;
  isSelf: boolean;
  weekPoints: number;
  rank: number;
  status: "cut" | "bubble" | "safe";
  // Set starting lineup, with points so far once games are played - see
  // lib/eliminationWatch.ts's rankLive.
  starters: TeamRosterRow[];
}

// Roster-slot categories the position radar chart ranks by - mirrors
// convex/infinidraft/draft/lineupOptimizer.ts's StarterCategory (SUPERFLEX
// folds into QB there, FLEX is its own axis - see that file's own comment).
export type StarterCategory = "QB" | "RB" | "WR" | "TE" | "DST" | "K" | "FLEX";

// Mirrors convex/infinileague/season/powerRankings.ts's TeamPositionRanks -
// powers the dashboard's expandable team cards' position radar chart (see
// components/PositionRadarChart.tsx). positionalRanks only includes
// categories this league actually starts (see that query's activeCategories
// filter) - a league with no K/DST/FLEX just omits that axis.
export interface TeamPositionRanks {
  teamId: string;
  gradeScore: number;
  positionalRanks: { category: StarterCategory; rank: number }[];
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
  // gap among them. 0/0 means nobody would start this player right now.
  demandCount: number;
  topDemandValue: number;
  // League-wide expected winning bid in dollars - the same for every team,
  // and the only bid shown.
  marketValue: number;
  // Set when a same-position teammate was just ruled Out or placed on IR -
  // a note only, not reflected in any value.
  boostReason: string | null;
}

export interface FaabSuggestionsResult {
  // Both null outside the NFL regular season (see convex/lib/faab.ts) - no
  // free-agent market to suggest bids against pre-season/post-season.
  week: string | null;
  season: string | null;
  remainingWeeks: number;
  suggestions: FaabSuggestionRow[];
  // The viewer's starting slots nobody on their roster can fill - shown as
  // one warning above the list. Empty without a teamId.
  openStarterSlots: string[];
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
  // Single-week counterpart to rosVor/rosRank/rosPpg/positionRank above -
  // "best play this week specifically" rather than summed over the rest of
  // the season. Powers the Players tab's week/rest-of-season toggle (see
  // convex/rosVor.ts's schema comment on weekVor for why this isn't just
  // rosVor/remainingWeeks).
  weekVor: number;
  weekRank: number;
  weekPpg: number;
  weekPositionRank: number;
  // Actual points scored this week in the league's scoring - not part of
  // convex/rosVor.ts's board itself; the Players tab merges it in from
  // getWeekPoints (live during games). Absent until the player has played.
  weekPoints?: number;
  // Usage score (convex/lib/usageScore.ts): season average and this
  // week's projection - null for K/DST or no data. weekUsageActual is
  // merged in by the Players tab from getWeekUsage once his game is final.
  seasonUsage: number | null;
  weekUsage: number | null;
  weekUsageActual?: number;
  rosteredByTeamName: string | null;
  // Absent means not currently injured - mirrors TeamRosterRow's injury
  // field below, same convex/injuries.ts source (Sleeper-derived).
  injury?: { status: string; statusShort: string };
  // True when this player is on the team the query's teamId arg named -
  // false when that arg was omitted (see getRosVorBoard's own comment), not
  // just for other teams. Optional (not just boolean) since TeamRosterList/
  // TradeRosterMatchup build minimal stand-in RosVorRows of their own that
  // don't set it - same "zero the fields PlayerCard doesn't use here"
  // convention as their other zeroed fields; absent reads the same as
  // false. Powers the Players tab's own-roster highlight (see
  // shared/PlayerCard.tsx's isOnMyTeam handling).
  isOnMyTeam?: boolean;
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
  dstScoring?: DstLiveScoring;
}

// Mirrors convex/infinileague/season/teamRoster.ts's DstLiveScoring (and
// convex/lib/dstScoring.ts's AllowedTier) - a DST row's league allowed
// tiers, its projection's breakdown and how much it has allowed so far,
// for liveProjection.
export interface AllowedTier {
  min: number;
  max: number | null;
  points: number;
}

export interface DstLiveScoring {
  pointsTiers: AllowedTier[];
  yardsTiers: AllowedTier[];
  allowed?: { points: number; yards: number };
  projectedPlays: number;
  projectedPointsAllowed: number;
  projectedYardsAllowed: number;
}

// Mirrors convex/infinileague/season/tradeValues.ts's TradeValueRow - a
// FantasyCalc-style trade value per player (thousands scale, additive):
// the blend of FantasyCalc's market value (null for K/DST, which it
// doesn't price) and our own rest-of-season value on the same scale.
export interface TradeValueRow {
  fpid: number;
  value: number;
  marketValue: number | null;
  // "Infinivalue".
  projectionValue: number;
  // Rank at his position by market value - the counterpart of the board's
  // positionRank. null when marketValue is.
  marketPositionRank: number | null;
  // We rank him well above ("buy") / below ("sell") where the market does
  // at his position.
  signal: "buy" | "sell" | null;
}
