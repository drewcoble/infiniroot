import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@infinidata/api";

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

// Every season across every league the signed-in user can run an auction
// for, whether they own it or were invited onto one of its teams - powers
// both the landing-page league picker and AppHeader's league switcher.
export function useMyAuctionSeasons(): LinkedSeason[] | undefined {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.leagues.listMyAuctionSeasons, isAuthenticated ? {} : "skip");
}
