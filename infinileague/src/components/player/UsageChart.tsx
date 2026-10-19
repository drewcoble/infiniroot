import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { api } from "@infinidata/api";
import { ChartTitle } from "../charts/ChartTitle";
import { SERIES } from "../charts/chartTheme";
import { WeeklyBars, type ChartSeries, type WeeklyBarDatum } from "../charts/WeeklyBars";

type UsagePart = "pass" | "rush" | "rec";

// Color follows the entity: rush is always slot 1, receiving slot 2,
// passing slot 3, whichever ones a position shows.
const USAGE_SERIES: Record<UsagePart, ChartSeries> = {
  rush: { key: "rush", label: "Rushing", color: SERIES[0] },
  rec: { key: "rec", label: "Receiving", color: SERIES[1] },
  pass: { key: "pass", label: "Passing", color: SERIES[2] },
};

const INFO = {
  flex:
    "Carries, targets, and red-zone chances, valued in fantasy points and compared to every " +
    "RB, WR, and TE each week (0–100).",
  qb:
    "Pass attempts, carries, and red-zone chances, valued in fantasy points and compared to " +
    "other QBs each week (0–100).",
};

// A player's weekly usage score for one NFL season (convex/infinileague/
// season/usage.ts), as stacked bars on a fixed 0-100 scale so any two
// players' charts compare. Needs the league route's season for its scoring
// - renders nothing outside a league, for K/DST, or before his first game.
export function UsageChart({ fpid, year }: { fpid: number; year: string }) {
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const usage = useQuery(
    api.infinileague.season.usage.getUsageWeeks,
    leagueId && isAuthenticated ? { seasonId: leagueId as Id<"seasons">, fpid, year } : "skip",
  );
  if (!usage || usage.average === null) return null;

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
  const data: WeeklyBarDatum[] = weeks.map((week) => ({
    week: week.week,
    kind: week.kind,
    values: parts.map((part) => week[part]),
  }));

  return (
    <div>
      <ChartTitle
        title="Usage score"
        info={position === "QB" ? INFO.qb : INFO.flex}
        stat={`Avg. ${Math.round(average)}`}
      />
      <WeeklyBars
        data={data}
        series={parts.map((part) => USAGE_SERIES[part])}
        max={100}
        reference={{ value: average, label: "Avg." }}
        barLabel={(_, total) => String(total)}
        ariaLabel={
          `Usage score by week, ${year}, averaging ${Math.round(average)}: ` +
          weeks
            .filter((week) => week.kind === "played")
            .map((week) => `week ${week.week} ${week.total}`)
            .join(", ")
        }
      />
    </div>
  );
}
