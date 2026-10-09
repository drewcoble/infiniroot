import type { CSSProperties } from "react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { pillStyle } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

export interface GlassPlayerRowData {
  rank: number;
  name: string;
  position: Position;
  // Rank within the position for whichever view/sort is showing - 0 = none.
  positionRank: number;
  team: string | null;
  rosteredByTeamName: string | null;
  isOnMyTeam: boolean;
  isRookie: boolean;
  injury?: { status: string; statusShort: string } | undefined;
  // What happened (week points / season PPG) large on the name's row - empty
  // when there's nothing yet - and the projection, small, under it.
  actual: string;
  projection: string;
}

// Rank chip outside the row - glass gray, saddlebrown for your own players
// (the app's "yours" color, as on the team cards and My Team header).
function rankChipStyle(isOnMyTeam: boolean): CSSProperties {
  return {
    color: isOnMyTeam ? "color-mix(in srgb, #8b4513 15%, #fff)" : "#f8fafc",
    fontFamily: "var(--font-numeric)",
    "--pill-tint": isOnMyTeam ? "#8b4513" : "var(--mantine-color-gray-5)",
  } as CSSProperties;
}

// One row of the Players board in the full-width glass card layout (see
// GlassRosterCard): name with rookie/injury badges | actual number, then
// position + NFL team + who rosters them | projection.
export function GlassPlayerRow({ data }: { data: GlassPlayerRowData }) {
  const owner = data.rosteredByTeamName;
  const label = [
    `Rank ${data.rank}`,
    data.name,
    `${data.position}${data.positionRank > 0 ? ` ${data.positionRank}` : ""}`,
    data.team,
    owner ? `rostered by ${owner}` : "free agent",
    data.isRookie ? "rookie" : null,
    data.injury?.status,
    data.actual || null,
    data.projection,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className={classes.rosterRow} role="group" aria-label={label}>
      <span
        className={`${classes.pill} ${classes.slotChip}`}
        style={rankChipStyle(data.isOnMyTeam)}
        aria-hidden
      >
        {data.rank}
      </span>
      <div className={`${classes.card} ${classes.wide} ${classes.playerRow}`} aria-hidden>
        <div className={`${classes.wideName} ${classes.teamCardName}`}>
          <span className={classes.name}>{data.name}</span>
          {data.isRookie && (
            <span className={`${classes.pill} ${classes.nameBadge}`} style={pillStyle("grape")}>
              R
            </span>
          )}
          {data.injury && (
            <span
              className={`${classes.pill} ${classes.nameBadge}`}
              style={pillStyle(injuryColor(data.injury.status))}
            >
              {data.injury.statusShort}
            </span>
          )}
        </div>
        <div className={`${classes.widePoints} ${classes.points} ${classes.playerPoints}`}>
          {data.actual}
        </div>
        <div className={classes.wideDetail}>
          <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
            {data.position}
            {data.positionRank > 0 ? data.positionRank : ""}
          </span>
          {owner ? (
            <span className={`${classes.gameLine} ${classes.wideGameLine}`}>
              <span className={classes.gameLineText}>
                {[data.team, owner].filter(Boolean).join(" · ")}
              </span>
            </span>
          ) : (
            <>
              {data.team && (
                <span className={`${classes.gameLine} ${classes.wideGameLine}`}>
                  <span className={classes.gameLineText}>{data.team}</span>
                </span>
              )}
              <span
                className={classes.pill}
                style={
                  {
                    color: "#f8fafc",
                    "--pill-tint": "var(--mantine-color-gray-5)",
                  } as CSSProperties
                }
              >
                FA
              </span>
            </>
          )}
        </div>
        <div className={classes.wideProj}>{data.projection}</div>
      </div>
    </div>
  );
}
