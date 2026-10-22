import { useState } from "react";
import type { Position } from "@shared/positionColors";
import { GlassSegmented } from "../cards/GlassSegmented";
import { PointsChart, type CurrentWeekPoints } from "./PointsChart";
import { UsageChart } from "./UsageChart";
import classes from "../charts/charts.module.css";

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
      {/* Both charts sit side by side in a strip, always drawn at full
          width, and the switch slides the strip - nothing re-measures or
          re-draws on a switch, and the section keeps the taller chart's
          height so nothing below it moves. The hidden one is inert. */}
      <div className={classes.trendViewport}>
        <div
          className={classes.trendTrack}
          style={{ transform: view === "points" ? "translateX(0)" : "translateX(-100%)" }}
        >
          <div className={classes.trendPane} inert={view !== "points"}>
            <PointsChart fpid={fpid} year={year} current={current} showTitle={false} />
          </div>
          <div className={classes.trendPane} inert={view !== "usage"}>
            <UsageChart fpid={fpid} year={year} showTitle={false} />
          </div>
        </div>
      </div>
    </div>
  );
}
