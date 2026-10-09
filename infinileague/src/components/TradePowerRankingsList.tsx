import { Stack } from "@mantine/core";
import { RankChangeBadge } from "./PowerRankingsList";
import { GlassTeamCard } from "./cards/GlassTeamCard";
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
  // This team's real, current (pre-trade) totalProjectedPoints - diffed
  // against its post-trade value for the two trading teams' "+/- pts"
  // line, same number the header and peek card show.
  beforePointsByTeam: Map<string, number>;
  // The two teams actually in the trade - everyone else renders plain (see
  // this component's own header comment on why only these two get a rank-
  // change badge).
  highlightedTeamIds: Set<string>;
}

function signedPoints(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)} pts`;
}

// Full-league power rankings recomputed as if a previewed trade happened
// (see trade.tsx), in the same glass team cards the league home's Power
// Rankings tab uses (GlassTeamCard) so this reads identically - just, for
// the two trading teams only, a badge for how many spots they'd move vs.
// today's real ranking and their rest-of-season points change. Other
// teams' ranks can still shift around them, but that's not the
// decision-relevant number here ("how would THIS trade affect us"), so they
// render without either.
export function TradePowerRankingsList({
  leagueId,
  rows,
  beforeRankByTeam,
  beforePointsByTeam,
  highlightedTeamIds,
}: TradePowerRankingsListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row, index) => {
        const afterRank = index + 1;
        const isHighlighted = highlightedTeamIds.has(row.teamId);
        const beforeRank = beforeRankByTeam.get(row.teamId);
        const beforePoints = beforePointsByTeam.get(row.teamId);
        const rankChange =
          isHighlighted && beforeRank !== undefined ? beforeRank - afterRank : undefined;
        const pointsDiff =
          isHighlighted && beforePoints !== undefined
            ? row.totalProjectedPoints - beforePoints
            : undefined;
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: afterRank,
              isSelf: row.isSelf,
              nameBadges: <RankChangeBadge rankChange={rankChange} since="after this trade" />,
              secondaryLeft: (
                <span className="num">
                  {row.rosPpg !== undefined ? `${row.rosPpg.toFixed(1)} ROS PPG` : "—"}
                </span>
              ),
              ...(pointsDiff !== undefined
                ? {
                    secondaryRight: (
                      <span
                        style={{
                          color:
                            pointsDiff > 0 ? "#4ade80" : pointsDiff < 0 ? "#f87171" : undefined,
                        }}
                      >
                        {signedPoints(pointsDiff)}
                      </span>
                    ),
                  }
                : {}),
              summary: [
                row.rosPpg !== undefined
                  ? `${row.rosPpg.toFixed(1)} rest-of-season PPG`
                  : undefined,
                pointsDiff !== undefined
                  ? `${signedPoints(pointsDiff)} after this trade`
                  : undefined,
              ]
                .filter(Boolean)
                .join(", "),
              stats: [
                { label: "ROS PPG", value: row.rosPpg !== undefined ? row.rosPpg.toFixed(1) : "—" },
                { label: "ROS proj pts", value: row.totalProjectedPoints.toFixed(0) },
                {
                  label: "Before trade",
                  value: beforeRank !== undefined ? `#${beforeRank}` : "—",
                },
              ],
            }}
            positionRanks={null}
            totalTeams={rows.length}
          />
        );
      })}
    </Stack>
  );
}
