import { Fragment, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { ChevronDown } from "lucide-react";
import { api } from "@infinidata/api";
import type { GenericId as Id } from "convex/values";
import { injuryColor } from "@shared/injuryColor";
import { pillStyle } from "./cardShared";
import classes from "./PlayerGameLog.module.css";

// The game log section of a player's long-press detail card - one
// collapsed row per season (Sleeper-style); expanding a year loads that
// season's weeks into a horizontally scrolling table. Only the expanded
// year is ever fetched. Needs the league route's season (the `leagueId`
// param) for this league's scoring - renders nothing outside a league.
export function PlayerGameLog({ fpid, position }: { fpid: number; position: string }) {
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const seasonId = leagueId as Id<"seasons"> | undefined;
  const seasons = useQuery(
    api.infinileague.season.gameLog.getGameLogSeasons,
    seasonId && isAuthenticated ? { seasonId, fpid } : "skip",
  );
  const [openYear, setOpenYear] = useState<string | null>(null);

  if (!seasonId || !seasons || seasons.length === 0) return null;

  return (
    <div className={classes.gameLog}>
      <div className={classes.title}>Game log</div>
      {seasons.map((season) => {
        const isOpen = openYear === season.season;
        return (
          <Fragment key={season.season}>
            <button
              type="button"
              className={classes.seasonHeader}
              aria-expanded={isOpen}
              onClick={() => setOpenYear(isOpen ? null : season.season)}
            >
              <span className={classes.seasonYear}>{season.season}</span>
              <span className={classes.seasonSummary}>
                {season.gamesPlayed > 0
                  ? `${season.gamesPlayed} GP · ${season.totalPoints.toFixed(1)} pts · ${(season.totalPoints / season.gamesPlayed).toFixed(1)} PPG`
                  : "No games yet"}
              </span>
              <ChevronDown
                size={16}
                className={[classes.chevron, isOpen && classes.chevronOpen].filter(Boolean).join(" ")}
              />
            </button>
            {isOpen && <SeasonTable seasonId={seasonId} fpid={fpid} year={season.season} position={position} />}
          </Fragment>
        );
      })}
    </div>
  );
}

function SeasonTable({
  seasonId,
  fpid,
  year,
  position,
}: {
  seasonId: Id<"seasons">;
  fpid: number;
  year: string;
  position: string;
}) {
  const log = useQuery(api.infinileague.season.gameLog.getGameLog, { seasonId, fpid, year });
  if (log === undefined) return <div className={classes.message}>Loading…</div>;
  if (log === null || log.weeks.length === 0) return <div className={classes.message}>No games recorded for {year}.</div>;

  // Consecutive columns sharing a group get one spanning header. Each
  // group's first column gets a divider on its left edge, so a stat reads
  // as Rushing vs. Receiving at a glance.
  const groups: Array<{ group: string; span: number }> = [];
  const groupClass: string[] = [];
  for (const column of log.columns) {
    const last = groups[groups.length - 1];
    const isStart = !last || last.group !== column.group;
    if (isStart) groups.push({ group: column.group, span: 1 });
    else last.span += 1;
    groupClass.push(isStart ? classes.groupStart! : "");
  }
  const statColumnCount = 3 + log.columns.length;

  return (
    <div className={classes.scroll}>
      <table className={classes.table}>
        <thead>
          <tr>
            <th className={classes.sticky} rowSpan={2}>
              Wk
            </th>
            <th rowSpan={2}>Status</th>
            <th rowSpan={2}>Pts</th>
            <th rowSpan={2}>Rank</th>
            {groups.map((group, index) => (
              <th
                key={`${group.group}-${index}`}
                colSpan={group.span}
                className={`${classes.group} ${classes.groupStart}`}
              >
                <span className={classes.groupLabel}>{group.group}</span>
              </th>
            ))}
          </tr>
          <tr>
            {log.columns.map((column, index) => (
              <th key={column.key} className={groupClass[index]}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {log.weeks.map((week) => (
            <tr key={week.week}>
              <td className={classes.sticky}>{week.week}</td>
              {week.kind === "bye" ? (
                <td colSpan={statColumnCount} className={classes.bye}>
                  <span className={classes.groupLabel}>BYE WEEK</span>
                </td>
              ) : (
                <>
                  <td>
                    {week.injury && (
                      <span className={classes.injury} style={pillStyle(injuryColor(week.injury.status))}>
                        {week.injury.statusShort}
                      </span>
                    )}
                  </td>
                  <td className={classes.points}>{week.points === null ? "—" : week.points.toFixed(1)}</td>
                  <td className={week.positionRank === null ? classes.dim : undefined}>
                    {week.positionRank === null ? "—" : `${position}${week.positionRank}`}
                  </td>
                  {log.columns.map((column, index) => {
                    const value = week.values[index];
                    return (
                      <td
                        key={column.key}
                        className={[groupClass[index], (value === null || value === undefined) && classes.dim]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {value === null || value === undefined ? "—" : value.toFixed(column.decimals)}
                      </td>
                    );
                  })}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
