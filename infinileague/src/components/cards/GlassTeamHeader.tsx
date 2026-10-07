import type { CSSProperties } from "react";
import type { StandingsRow } from "../../types/season";
import { GameStatusGlyph } from "./GameStatusGlyph";
import classes from "./GlassMatchupCard.module.css";

export interface TeamWeekSummary {
  actualPoints: number;
  // Live projection while games remain; the original pregame projection
  // once every starter's game is final (see teams/$teamId.tsx).
  projectedPoints: number;
  // Starters whose games are underway / not yet started.
  liveCount: number;
  toPlayCount: number;
}

// Standings rank as a glass badge like the player cards' position badges,
// tinted saddlebrown - the same "this one's yours" color the old cards used
// for your own players/selections (shared/PlayerCard.tsx).
const RANK_PILL_STYLE = {
  color: "color-mix(in srgb, #8b4513 15%, #fff)",
  fontFamily: "var(--font-numeric)",
  fontWeight: 400,
  "--pill-tint": "#8b4513",
} as CSSProperties;

// Points for per game played - null before any game has been played.
function seasonPpg(team: StandingsRow): number | null {
  const games = team.wins + team.losses + team.ties;
  return games > 0 ? team.pointsFor / games : null;
}

// My Team's header in the same glass as the Matchup header and roster
// cards, on two shared rows like the full-width player card: team name |
// the week's score, then the season line (rank, record, points per game) |
// the starters' live/to-play counts and the week's projection. The week
// itself is picked from the page's title row (see WeekPicker). `team`
// undefined = standings still loading; `summary` undefined = the week's
// roster still loading (shimmer placeholders either way). Before any
// starter has kicked off there's no score yet - that slot stays empty and
// the projection sits on its usual row, same as the player cards.
export function GlassTeamHeader({
  team,
  summary,
}: {
  team: StandingsRow | undefined;
  summary: TeamWeekSummary | undefined;
}) {
  const notStarted =
    summary !== undefined &&
    summary.liveCount === 0 &&
    summary.toPlayCount > 0 &&
    summary.actualPoints === 0;
  const ppg = team ? seasonPpg(team) : null;

  return (
    <div
      className={`${classes.card} ${classes.header} ${classes.teamHeader}`}
      aria-busy={team === undefined || summary === undefined}
    >
      {team === undefined ? (
        <>
          <span
            className={`${classes.skeletonBar} ${classes.teamHeaderName}`}
            style={{ width: "55%", height: 18 }}
          />
          <span
            className={`${classes.skeletonBar} ${classes.teamHeaderSeason}`}
            style={{ width: "45%", height: 12 }}
          />
        </>
      ) : (
        <>
          <h3 className={classes.teamHeaderName}>{team.name}</h3>
          <div className={classes.teamHeaderSeason}>
            <span className={classes.pill} style={RANK_PILL_STYLE} aria-label={`Rank ${team.rank}`}>
              #{team.rank}
            </span>
            <span>
              {team.wins}-{team.losses}-{team.ties}
              {ppg !== null && ` · ${ppg.toFixed(1)} PPG`}
            </span>
          </div>
        </>
      )}

      {summary === undefined ? (
        <>
          <span
            className={`${classes.skeletonBar} ${classes.teamHeaderTotal}`}
            style={{ width: 80, height: 20 }}
          />
          <span
            className={`${classes.skeletonBar} ${classes.teamHeaderProj}`}
            style={{ width: 72, height: 12 }}
          />
        </>
      ) : (
        <>
          <span className={classes.teamHeaderTotal}>
            {notStarted ? "" : summary.actualPoints.toFixed(2)}
          </span>
          <div
            className={`${classes.headerProj} ${classes.teamHeaderProj}`}
            aria-label={`${summary.liveCount} live, ${summary.toPlayCount} to play, projected ${summary.projectedPoints.toFixed(1)}`}
          >
            {summary.liveCount > 0 && (
              <span className={classes.headerCount}>
                <GameStatusGlyph state="live" />
                {summary.liveCount}
              </span>
            )}
            {summary.toPlayCount > 0 && (
              <span className={classes.headerCount}>
                <GameStatusGlyph state="pre" />
                {summary.toPlayCount}
              </span>
            )}
            <span>Proj {summary.projectedPoints.toFixed(1)}</span>
          </div>
        </>
      )}
    </div>
  );
}
