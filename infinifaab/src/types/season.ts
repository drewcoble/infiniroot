// Minimal shape infinifaab actually reads off api.leagues.listMyAuctionSeasons
// - same convention infinileague's own types/season.ts documents ("define a
// local interface for the shape you actually consume", since none of
// infinidraft's Convex functions declare an explicit `returns` validator).
// leagueId/year drive groupSeasonsByLeague; the rest is what the dashboard
// card / header picker display.
export interface LinkedSeason {
  _id: string;
  leagueId: string;
  year: string;
  name: string;
  teamCount: number;
  scoring: "STD" | "HALF" | "PPR";
}

// Mirrors convex/infinileague/auction/participant.ts's MyParticipation.
export interface MyParticipation {
  isCommissioner: boolean;
  teams: Array<{ teamId: string; name: string }>;
}

// Mirrors convex/infinileague/auction/bids.ts's AuctionDashboardRow.
export interface AuctionDashboardRow {
  teamId: string;
  teamName: string;
  faabRemaining: number;
  activeWinningBids: number;
}

// Mirrors convex/infinileague/auction/eligibility.ts's CycleType.
export type CycleType = "weekly" | "playerDrop" | "manual";

// Mirrors convex/infinileague/auction/players.ts's WaiverPlayerRow.
// cycleId/closesAt are absent for a "weekly" row when no weekly cycle
// happens to be open right now - the player still shows, just isn't
// bid-able yet (see eligibility.ts's EligibleCycleRef comment).
export interface WaiverPlayerRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  rosteredByTeamName: null;
  injury?: { status: string; statusShort: string };
  cycleType: CycleType;
  cycleId?: string;
  closesAt?: number;
}

// Mirrors convex/infinileague/auction/bids.ts's AuctionBoardRow, plus the
// openCycles list getAuctionBoardState returns alongside it.
export interface AuctionBoardRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
}

export interface AuctionCycle {
  _id: string;
  type?: CycleType;
  opensAt: number;
  closesAt: number;
  status: "open" | "closed";
}

// Mirrors convex/infinileague/auction/bids.ts's BidBoardRow - extends
// PlayerDisplayInfo so this satisfies @shared/PlayerCard's PlayerCardRow
// directly (the Bids tab renders the same PlayerCard the Players tab does).
export interface BidBoardRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  name: string;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  team: string | null;
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  rosteredByTeamName: null;
  injury?: { status: string; statusShort: string };
  currentPrice: number;
  leadingTeamName: string | null;
  bidCount: number;
  myMaxBid: number | null;
  myTeamName: string | null;
  category: "winning" | "outbid" | "other";
}

// Mirrors convex/infinileague/auction/bids.ts's MyBidRow.
export interface MyBidRow {
  fpid: number;
  cycleId: string;
  cycleType: CycleType;
  closesAt: number;
  teamId: string;
  teamName: string;
  maxBid: number;
}

// Mirrors convex/infinileague/auction/cycles.ts's AuctionResultRow.
export interface AuctionResultRow {
  cycleId: string;
  closesAt: number;
  fpid: number;
  playerName: string | null;
  winnerTeamName: string | null;
  price: number | null;
}

// Mirrors convex/infinileague/auction/settings.ts's stored/default shape.
export interface AuctionSettings {
  enabled: boolean;
  closeWeekday: number;
  closeHour: number;
  closeMinute: number;
  timeZone: string;
  minIncrement: number;
  startingBid: number;
  antiSnipeMinutes: number;
  tieBreakMode: "earliest" | "waiverOrder";
  dropCycleDurationHours: number;
}

// Mirrors convex/infinileague/auction/players.ts's ManualCycleCandidateRow -
// the commissioner-only picker for mechanism 3 (startManualAuctionCycle),
// deliberately wider than WaiverPlayerRow (no kickoff gate).
export interface ManualCycleCandidateRow {
  fpid: number;
  name: string;
  team: string | null;
  position: "QB" | "RB" | "WR" | "TE" | "DST" | "K";
  rosRank: number;
  positionRank: number;
  rosPpg: number;
  actualPpg: number;
  injury?: { status: string; statusShort: string };
}

// Mirrors convex/infinileague/auction/invites.ts's TeamInviteRow.
export interface TeamInviteRow {
  teamId: string;
  teamName: string;
  token: string | null;
  members: Array<{ userId: string; name: string | null }>;
}
