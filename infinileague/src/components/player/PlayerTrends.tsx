import { useState } from "react";
import type { Position } from "@shared/positionColors";
import { GlassSegmented } from "../cards/GlassSegmented";
import { PointsChart, type CurrentWeekPoints } from "./PointsChart";
import { UsageChart } from "./UsageChart";

type TrendView = "points" | "usage";

// The last chart picked, so the next popover opens on it too - for the
// session only.
let lastView: TrendView = "points";

// The player popover's week-by-week section: points and usage share one
// spot, switched with the same compact segmented control the Players page
// sorts with. The switch names the chart, so the chart drops its own title
// (keeping its info button and average). K/DST have no usage score - just
// points, with its title.
export function PlayerTrends({
  fpid,
  year,
  position,
  current,
}: {
  fpid: number;
  year: string;
  position: Position;
  current: CurrentWeekPoints | undefined;
}) {
  const [view, setView] = useState<TrendView>(lastView);
  const hasUsage = position !== "K" && position !== "DST";

  if (!hasUsage) return <PointsChart fpid={fpid} year={year} current={current} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <GlassSegmented
        compact
        label="Weekly chart"
        value={view}
        onChange={(next) => {
          lastView = next;
          setView(next);
        }}
        options={[
          { label: "Points", value: "points" as const },
          { label: "Usage", value: "usage" as const },
        ]}
      />
      {/* Both stay mounted (and loaded) - the switch only shows one - so
          switching is instant and doesn't make the popover shrink while
          the other chart's data loads. */}
      <div hidden={view !== "points"}>
        <PointsChart fpid={fpid} year={year} current={current} showTitle={false} />
      </div>
      <div hidden={view !== "usage"}>
        <UsageChart fpid={fpid} year={year} showTitle={false} />
      </div>
    </div>
  );
}
