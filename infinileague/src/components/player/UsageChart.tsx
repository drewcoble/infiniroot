import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { positionColorVar } from "@shared/positionColors";
import { ChartTitle } from "../charts/ChartTitle";
import { ChartLoading } from "./chartLoading";
import { WeeklyBars, type ChartSeries, type WeeklyBarDatum } from "../charts/WeeklyBars";

type UsagePart = "pass" | "rush" | "rec";

// Each part wears the app's color for the position it's most associated
// with - passing QB yellow, rushing RB green, receiving WR blue - drawn as
// glass in the badges' own tint (shade 4), so a bar reads exactly like that
// position's badge.
const USAGE_SERIES: Record<UsagePart, ChartSeries> = {
  rush: { key: "rush", label: "Rushing", color: positionColorVar("RB", 4), glass: true },
  rec: { key: "rec", label: "Receiving", color: positionColorVar("WR", 4), glass: true },
  pass: { key: "pass", label: "Passing", color: positionColorVar("QB", 4), glass: true },
};

const INFO = {
  flex: "Carries, targets, and red-zone looks, compiled into a 0–100 score.",
  qb: "Pass attempts, carries, and red-zone looks, compiled into a 0–100 score.",
};

// A player's weekly usage score for one NFL season (convex/infinileague/
// season/usage.ts), as stacked bars on a fixed 0-100 scale so any two
// players' charts compare. Needs the league route's season for its scoring
// - renders nothing outside a league, for K/DST, or before his first game.
export function UsageChart({
  fpid,
  year,
  showTitle = true,
}: {
  fpid: number;
  year: string;
  // False when a switch above already names the chart (PlayerTrends).
  showTitle?: boolean;
}) {
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const usage = useQuery(
    api.infinileague.season.usage.getUsageWeeks,
    leagueId && isAuthenticated ? { seasonId: leagueId as Id<"seasons">, fpid, year } : "skip",
  );
  if (usage === undefined) return <ChartLoading />;
  if (usage === null || usage.average === null) return null;

  const { position, weeks, average } = usage;
  // Rushing and receiving for everyone; passing only for a QB; a QB's
  // receiving, or a WR/TE's rushing, only when there's any.
  const has = (part: UsagePart) => weeks.some((week) => week[part] > 0);
  const parts: UsagePart[] =
    position === "QB"
      ? ["pass", "rush", ...(has("rec") ? (["rec"] as const) : [])]
      : position === "RB"
        ? ["rush", "rec"]
        : ["rec", ...(has("rush") ? (["rush"] as const) : [])];
  // A projected week has a total but no split - drawn as one bar.
  const data: WeeklyBarDatum[] = weeks.map((week) => ({
    week: week.week,
    kind: week.kind,
    values: week.kind === "projected" ? [week.total] : parts.map((part) => week[part]),
  }));
  const projected = weeks.find((week) => week.kind === "projected");

  return (
    <div>
      <ChartTitle
        title="Usage score"
        showTitle={showTitle}
        info={position === "QB" ? INFO.qb : INFO.flex}
        stat={`Avg. ${Math.round(average)}`}
      />
      <WeeklyBars
        data={data}
        series={parts.map((part) => USAGE_SERIES[part])}
        max={100}
        reference={{ value: average, label: "Avg." }}
        barLabel={(_, total) => String(total)}
        visibleWeeks={6}
        ariaLabel={
          `Usage score by week, ${year}, averaging ${Math.round(average)}: ` +
          weeks
            .filter((week) => week.kind === "played")
            .map((week) => `week ${week.week} ${week.total}`)
            .join(", ") +
          (projected ? `; week ${projected.week} projected ${projected.total}` : "")
        }
      />
    </div>
  );
}
