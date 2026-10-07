import { Stack } from "@mantine/core";
import { pillStyle } from "./cards/cardShared";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import { GlassRosterSkeletonCard } from "./cards/GlassRosterCard";
import classes from "./cards/GlassMatchupCard.module.css";
import type { EliminationWatchRow, TeamPositionRanks } from "../types/season";

interface EliminationWatchListProps {
  leagueId: string;
  rows: EliminationWatchRow[] | undefined;
  // See StandingsList's identical prop.
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

// Same red/gold/green three-band convention lib/gradeColor.ts uses (see
// that file's comment on why those, not raw Mantine "yellow") - here keyed
// off eliminationWatch.ts's own cut/bubble/safe status instead of a
// continuous score.
const STATUS_BADGE: Record<EliminationWatchRow["status"], { label: string; color: string }> = {
  cut: { label: "Projected Cut", color: "red" },
  bubble: { label: "Bubble", color: "gold" },
  safe: { label: "Safe", color: "green" },
};

// This week's guillotine elimination projection: each team's optimal-lineup
// total for just the current NFL week (see convex/infinileague/season/
// eliminationWatch.ts), ranked best-to-worst same as PowerRankingsList, with
// the bottom slice flagged red (projected cut) / gold (bubble) / green
// (safe) via the status badge instead of a week-over-week rank arrow.
export function EliminationWatchList({
  leagueId,
  rows,
  positionRanksByTeam,
}: EliminationWatchListProps) {
  if (rows === undefined) {
    return (
      <Stack gap={8}>
        {Array.from({ length: 8 }, (_, index) => (
          <GlassRosterSkeletonCard key={index} />
        ))}
      </Stack>
    );
  }

  return (
    <Stack gap={8}>
      {rows.map((row) => {
        const status = STATUS_BADGE[row.status];
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: row.rank,
              isSelf: row.isSelf,
              nameBadges: (
                <span className={classes.pill} style={pillStyle(status.color)}>
                  {status.label}
                </span>
              ),
              primary: row.weekPoints.toFixed(1),
              secondaryRight: "Week pts",
              stats: [
                { label: "Week pts", value: row.weekPoints.toFixed(1) },
                { label: "Status", value: status.label },
              ],
            }}
            positionRanks={positionRanksByTeam?.get(row.teamId)}
            totalTeams={rows.length}
          />
        );
      })}
    </Stack>
  );
}
