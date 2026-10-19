import { createContext, useContext } from "react";

// Every team's logo URL in the current league, by teamId - provided once by
// the league layout from getStandings (which carries seasonTeams.logoUrl),
// so cards built from other queries (power rankings, elimination watch)
// needn't each carry it.
export const TeamLogosContext = createContext<ReadonlyMap<string, string>>(new Map());

export function useTeamLogoUrl(teamId: string | null | undefined): string | undefined {
  const logos = useContext(TeamLogosContext);
  return teamId ? logos.get(teamId) : undefined;
}
