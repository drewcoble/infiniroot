import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import type { GameState } from "../cards/cardShared";
import { ChartTitle } from "../charts/ChartTitle";
import { WeeklyBars, type ChartSeries, type WeeklyBarDatum } from "../charts/WeeklyBars";

// The app's brown - the same saddlebrown your-team rank chip is tinted with
// (cardShared's rankPillStyle), as glass like every other chart mark.
const POINTS_SERIES: ChartSeries = {
  key: "points",
  label: "Points",
  color: "#8b4513",
  glass: true,
};

// This NFL week's game for the player, from the popover's live data.
export interface CurrentWeekPoints {
  week: number;
  state: GameState | undefined;
  // Points so far (live) or final.
  actual: number | undefined;
  // This week's pregame projection.
  projection: number | undefined;
}

const formatPoints = (points: number) => points.toFixed(1);

// A player's fantasy points by week for one NFL season, in this league's
// scoring - past weeks from the game log (convex/infinileague/season/
// gameLog.ts), this week from the popover's live data: the projection as a
// gray dashed bar before kickoff, points so far over that dashed projection
// while he plays, then a bar like any other once it's final. Same 6-week
// scrolling chart as UsageChart. Renders nothing outside a league or
// before his first game or projection.
export function PointsChart({
  fpid,
  year,
  current,
}: {
  fpid: number;
  year: string;
  current: CurrentWeekPoints | undefined;
}) {
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const log = useQuery(
    api.infinileague.season.gameLog.getGameLog,
    leagueId && isAuthenticated ? { seasonId: leagueId as Id<"seasons">, fpid, year } : "skip",
  );
  if (!log) return null;

  const data: WeeklyBarDatum[] = log.weeks
    .filter((week) => week.week !== current?.week)
    .map((week) => ({
      week: week.week,
      kind: week.kind,
      values: [Math.max(week.points ?? 0, 0)],
    }));

  if (current) {
    const { state, actual, projection } = current;
    if (state === "bye") {
      data.push({ week: current.week, kind: "bye", values: [0] });
    } else if (state === "final") {
      data.push(
        actual !== undefined
          ? { week: current.week, kind: "played", values: [Math.max(actual, 0)] }
          : { week: current.week, kind: "dnp", values: [0] },
      );
    } else if (state === "live") {
      data.push({
        week: current.week,
        kind: "played",
        values: [Math.max(actual ?? 0, 0)],
        projection,
      });
    } else if (projection !== undefined && projection > 0) {
      data.push({ week: current.week, kind: "projected", values: [projection] });
    }
  }

  if (!data.some((datum) => datum.kind === "played" || datum.kind === "projected")) return null;
  // Games he's finished - this week's only once it's final.
  const finished = data.filter(
    (datum) => datum.kind === "played" && datum.projection === undefined,
  );
  const average =
    finished.length > 0
      ? finished.reduce((sum, datum) => sum + (datum.values[0] ?? 0), 0) / finished.length
      : undefined;

  return (
    <div>
      <ChartTitle
        title="Points"
        info="Fantasy points each week, in your league's scoring."
        stat={average !== undefined ? `Avg. ${formatPoints(average)}` : undefined}
      />
      <WeeklyBars
        data={data}
        series={[POINTS_SERIES]}
        reference={average !== undefined ? { value: average, label: "Avg." } : undefined}
        barLabel={(_, total) => formatPoints(total)}
        visibleWeeks={6}
        ariaLabel={
          `Fantasy points by week, ${year}` +
          (average !== undefined ? `, averaging ${formatPoints(average)}` : "") +
          ": " +
          data
            .filter((datum) => datum.kind === "played" || datum.kind === "projected")
            .map(
              (datum) =>
                `week ${datum.week} ${datum.kind === "projected" ? "projected " : ""}` +
                formatPoints(datum.values[0] ?? 0),
            )
            .join(", ")
        }
      />
    </div>
  );
}
