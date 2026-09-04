import { Stack, Text } from "@mantine/core";
import { RankChangeIndicator } from "./PowerRankingsList";
import { TeamCard } from "./TeamCard";
import type { PowerRankingRow } from "../types/season";

interface TradePowerRankingsListProps {
  leagueId: string;
  // Already ranked descending by totalProjectedPoints, as if the
  // previewed trade actually happened (see convex/infinileague/season/
  // powerRankings.ts's getPowerRankingsWithTrade) - every team's row, not
  // just the two trading teams, since a third team's own rank can still
  // shift if one of the trading teams crosses past them.
  rows: PowerRankingRow[];
  // This team's rank in the real, current (pre-trade) power rankings -
  // absent for any team not in the map is treated as "no change" rather
  // than fabricating a delta.
  beforeRankByTeam: Map<string, number>;
  // The two teams actually in the trade - everyone else renders plain (see
  // this component's own header comment on why only these two get a rank-
  // change indicator).
  highlightedTeamIds: Set<string>;
}

// Full-league power rankings recomputed as if a previewed trade happened
// (see trade.tsx), reusing the same TeamCard/RankChangeIndicator the league
// dashboard's real PowerRankingsList uses so this reads identically -
// just highlighting the two trading teams and, only for those two, how many
// spots they'd move vs. today's real ranking. Other teams' own ranks can
// still shift around them, but that's not the decision-relevant number here
// (see the trade tab's own framing - "how would THIS trade affect us"), so
// they render without a rank-change badge.
export function TradePowerRankingsList({
  leagueId,
  rows,
  beforeRankByTeam,
  highlightedTeamIds,
}: TradePowerRankingsListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row, index) => {
        const afterRank = index + 1;
        const isHighlighted = highlightedTeamIds.has(row.teamId);
        const beforeRank = beforeRankByTeam.get(row.teamId);
        const rankChange =
          isHighlighted && beforeRank !== undefined ? beforeRank - afterRank : undefined;
        return (
          <TeamCard
            key={row.teamId}
            leagueId={leagueId}
            teamId={row.teamId}
            name={row.name}
            isSelf={row.isSelf}
            leftLabel={afterRank}
            highlighted={isHighlighted}
            nameSuffix={isHighlighted ? <RankChangeIndicator rankChange={rankChange} /> : null}
            stats={
              <Text size="sm" fw={500}>
                {row.totalProjectedPoints.toFixed(1)} pts
              </Text>
            }
          />
        );
      })}
    </Stack>
  );
}
