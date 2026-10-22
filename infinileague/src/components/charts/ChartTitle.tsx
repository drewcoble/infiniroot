import type { ReactNode } from "react";
import { Popover } from "@mantine/core";
import { Info } from "lucide-react";
import classes from "./charts.module.css";

// A chart's title row: its name, an info button whose popover says in a
// sentence what the number is (not how it's computed), and the chart's
// one headline stat on the right ("Avg. 46"). `showTitle` false leaves
// the name to whatever's above (a switch that already names the chart) -
// it still labels the info button for screen readers.
export function ChartTitle({
  title,
  info,
  stat,
  showTitle = true,
}: {
  title: string;
  info?: ReactNode;
  stat?: string | undefined;
  showTitle?: boolean;
}) {
  return (
    <div className={classes.titleRow}>
      <span className={classes.title}>
        {showTitle && title}
        {info && (
          // Above the player popover (GlassPopover's scrim and card sit at
          // 1000 / 1001), which the usage chart lives inside.
          <Popover position="bottom-start" offset={6} zIndex={1002}>
            <Popover.Target>
              <button type="button" className={classes.infoButton} aria-label={`About ${title}`}>
                <Info size={15} strokeWidth={2.25} />
              </button>
            </Popover.Target>
            <Popover.Dropdown className={classes.infoPopover!}>{info}</Popover.Dropdown>
          </Popover>
        )}
      </span>
      {stat && <span className={classes.titleStat}>{stat}</span>}
    </div>
  );
}
