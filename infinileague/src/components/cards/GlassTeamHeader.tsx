import type { CSSProperties } from "react";
import type { StandingsRow } from "../../types/season";
import { rankPillStyle } from "./cardShared";
import { GameStatusGlyph } from "./GameStatusGlyph";
import { TeamLogo } from "./TeamLogo";
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

// Standings rank as a glass badge like the player cards' position badges -
// the same gray as every other team's rank badge (saddlebrown read as
// confusing), with the numeric weight on top.
const RANK_PILL_STYLE = {
  ...rankPillStyle(false),
  fontWeight: "var(--font-numeric-weight)",
} as CSSProperties;

// Points for per game played - null before any game has been played.
function seasonPpg(team: StandingsRow): number | null {
  const games = team.wins + team.losses + team.ties;
  return games > 0 ? team.pointsFor / games : null;
}

// The logo spans both of the header's rows (see .teamHeaderLogo).
const TEAM_HEADER_LOGO_SIZE = 46;

// My Team's header in the same glass as the Matchup header and roster
// cards, on two shared rows like the full-width player card, beside the
// team's logo (TeamLogo, initials without one) spanning both: rank badge and
// team name | the week's score, then the season line (record, points per
// game) | the starters' live/to-play counts and the week's projection. The week
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
            className={`${classes.skeletonBar} ${classes.teamHeaderLogo}`}
            style={{ width: TEAM_HEADER_LOGO_SIZE, height: TEAM_HEADER_LOGO_SIZE, borderRadius: 14 }}
          />
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
          <TeamLogo
            name={team.name}
            logoUrl={team.logoUrl}
            size={TEAM_HEADER_LOGO_SIZE}
            className={classes.teamHeaderLogo}
          />
          <div className={classes.teamHeaderTitle}>
            <span className={classes.pill} style={RANK_PILL_STYLE} aria-label={`Rank ${team.rank}`}>
              #{team.rank}
            </span>
            <h3 className={classes.teamHeaderName} title={team.name}>
              {team.name}
            </h3>
          </div>
          <div className={classes.teamHeaderSeason}>
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
