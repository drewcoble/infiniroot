import { useMemo, useState } from "react";
import { Badge, Stack, Text } from "@mantine/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PlayoffFormat } from "@playoffRules/format";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { previewFormat } from "../lib/formatPreview";
import classes from "./FormatPreview.module.css";

function weekLabel(weeks: number[]): string {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `Wk ${first}` : `Wk ${first}-${last}`;
}

// The playoffs as weeks and seed matchups - the saved rules, or the
// commissioner's unsaved edits as they make them. Minimizes to one line.
export function FormatPreview({
  format,
  teamCount,
  unsaved,
}: {
  format: PlayoffFormat | null;
  teamCount: number;
  unsaved: boolean;
}) {
  const [open, setOpen] = useState(true);
  const stages = useMemo(
    () => (format ? previewFormat(format, teamCount) : []),
    [format, teamCount],
  );

  return (
    <div className={`${glass.card} ${classes.dock}`}>
      <button
        type="button"
        className={classes.toggle}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={glass.sectionLabel}>Preview</span>
        {unsaved && (
          <Badge size="xs" color="yellow" variant="light">
            Unsaved
          </Badge>
        )}
        <Text size="xs" c="dimmed" style={{ flex: 1 }} truncate>
          {format ? `Regular season wk 1-${format.regularSeasonEndWeek}` : "No playoffs"}
        </Text>
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
      {open && stages.length > 0 && (
        <div className={classes.body}>
          {stages.map((stage) => (
            <Stack key={stage.id} gap={4}>
              <span className={classes.stageName}>{stage.name}</span>
              <div className={classes.columns}>
                {stage.columns.map((column, i) => (
                  <div key={i} className={classes.column}>
                    <span className={classes.week}>{weekLabel(column.weeks)}</span>
                    <span className={classes.round}>{column.name}</span>
                    {column.games.map(({ sides: [a, b] }, g) => (
                      <span key={g} className={classes.game}>
                        {b === null ? (
                          <>
                            {a} <span className={classes.bye}>· bye</span>
                          </>
                        ) : (
                          `${a} vs ${b}`
                        )}
                      </span>
                    ))}
                    {column.note && <span className={classes.note}>{column.note}</span>}
                  </div>
                ))}
              </div>
              {stage.caption && (
                <Text size="xs" c="dimmed">
                  {stage.caption}
                </Text>
              )}
            </Stack>
          ))}
        </div>
      )}
    </div>
  );
}
