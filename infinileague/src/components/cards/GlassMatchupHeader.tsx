import { GameStatusGlyph } from "./GameStatusGlyph";
import classes from "./GlassMatchupCard.module.css";

export interface MatchupHeaderTeam {
  name: string;
  actualPoints: number;
  // Live projection - actual so far plus the unplayed share of each
  // starter's projection, same total the current Matchup tab shows as "Proj".
  projectedPoints: number;
  // Starters whose games are underway / not yet started.
  liveCount: number;
  toPlayCount: number;
}

// Each win-probability segment is tinted by who's favored rather than by
// team (there's no team-color concept): green for the favorite, red for the
// underdog, neutral for both when it's within TOSSUP_MARGIN of 50/50 - the
// same green/red/neutral the player cards' meters use for pace.
const TOSSUP_MARGIN = 3;
const FAVORED_TINT = "#4ade80";
const UNDERDOG_TINT = "#f87171";
const TOSSUP_TINT = "#9ca3af";

function segmentTint(pct: number): string {
  if (pct > 50 + TOSSUP_MARGIN) return FAVORED_TINT;
  if (pct < 50 - TOSSUP_MARGIN) return UNDERDOG_TINT;
  return TOSSUP_TINT;
}

// `hideFinal`: the header's result line already says the week is over, so
// the per-side "Final" would just repeat it.
function TeamSide({
  team,
  align,
  hideFinal,
}: {
  team: MatchupHeaderTeam;
  align: "left" | "right";
  hideFinal: boolean;
}) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      <div className={classes.headerTeamName}>{team.name}</div>
      <div className={classes.headerTotal}>{team.actualPoints.toFixed(2)}</div>
      {/* Projection and what's left on one line - the same dot/clock as the
          player cards' corners, so the counts need no words here (the
          card's aria-label spells them out). */}
      <div className={classes.headerProj}>
        <span>Proj {team.projectedPoints.toFixed(1)}</span>
        {team.liveCount > 0 && (
          <span className={classes.headerCount}>
            <GameStatusGlyph state="live" />
            {team.liveCount}
          </span>
        )}
        {team.toPlayCount > 0 && (
          <span className={classes.headerCount}>
            <GameStatusGlyph state="pre" />
            {team.toPlayCount}
          </span>
        )}
        {!hideFinal && team.liveCount === 0 && team.toPlayCount === 0 && <span>Final</span>}
      </div>
    </div>
  );
}

function countsText(team: MatchupHeaderTeam): string {
  if (team.liveCount === 0 && team.toPlayCount === 0) return "all games final";
  return `${team.liveCount} live, ${team.toPlayCount} to play`;
}

// Shimmering stand-in for one side while that team's roster loads (or,
// on the right, while the week's opponent is still being looked up).
function TeamSideSkeleton({ align }: { align: "left" | "right" }) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      <span className={classes.skeletonBar} style={{ width: "70%", height: 14 }} />
      <span className={classes.skeletonBar} style={{ width: "62%", height: 28, marginTop: 4 }} />
      <span className={classes.skeletonBar} style={{ width: "48%", height: 11, marginTop: 4 }} />
    </div>
  );
}

// Glass version of the Matchup tab's score header: both teams' scores,
// live projections, how many starters are still live / yet to play, and
// the win-probability split. `winProbA` is team A's 0-1 share. No "VS" or
// "Win probability" caption - the facing columns and the split bar with a
// percentage at each end say both.
//
// Either side can be "loading" (shimmering placeholder - roster still
// loading, or for teamB the opponent still being looked up). `teamB` null
// = resolved with no opponent (a bye week before one's picked manually):
// right side shows a dimmed placeholder, no win bar. `winProbA` null =
// both teams known but a roster's still loading - the bar holds at a
// dimmed 50/50 rather than showing a wrong number that then jumps.
//
// `result` (e.g. "Final · Gridiron Gurus won by 13.74") replaces the win
// bar once every game of the week is over - a "97%" after the fact reads
// oddly.
export function GlassMatchupHeader({
  teamA,
  teamB,
  winProbA,
  result,
}: {
  teamA: MatchupHeaderTeam | "loading";
  teamB: MatchupHeaderTeam | "loading" | null;
  winProbA: number | null;
  result?: string | undefined;
}) {
  const pctA = Math.round((winProbA ?? 0.5) * 100);
  const pctB = 100 - pctA;
  const teamText = (team: MatchupHeaderTeam) =>
    `${team.name} ${team.actualPoints.toFixed(2)}, projected ${team.projectedPoints.toFixed(1)}, ${countsText(team)}`;
  const loaded = teamA !== "loading" && teamB !== "loading" && teamB !== null;
  const ariaLabel =
    teamA === "loading"
      ? "Loading matchup"
      : teamB === "loading" || teamB === null
        ? teamText(teamA)
        : `${teamText(teamA)}; ${teamText(teamB)}` +
          (result
            ? `; ${result}`
            : winProbA !== null
              ? `; win probability ${pctA}% to ${pctB}%`
              : "");
  return (
    <div
      className={`${classes.card} ${classes.header}`}
      role="group"
      aria-label={ariaLabel}
      aria-busy={teamA === "loading" || teamB === "loading"}
    >
      <div className={classes.headerTeams} aria-hidden>
        {teamA === "loading" ? (
          <TeamSideSkeleton align="left" />
        ) : (
          <TeamSide team={teamA} align="left" hideFinal={Boolean(result)} />
        )}
        {teamB === "loading" ? (
          <TeamSideSkeleton align="right" />
        ) : teamB ? (
          <TeamSide team={teamB} align="right" hideFinal={Boolean(result)} />
        ) : (
          <div
            className={`${classes.headerTeam} ${classes.headerTeamRight} ${classes.headerPending}`}
          >
            <div className={classes.headerTeamName}>Opponent</div>
            <div className={classes.headerTotal}>—</div>
          </div>
        )}
      </div>

      {loaded && result && <div className={classes.headerResult}>{result}</div>}

      {teamB !== null && !(loaded && result) && (
        <div
          className={`${classes.winRow} ${!loaded || winProbA === null ? classes.headerPending : ""}`}
          aria-hidden
        >
          <span>{loaded && winProbA !== null ? `${pctA}%` : "–"}</span>
          <div className={classes.winBar}>
            <div
              className={classes.winSegment}
              style={{
                width: `${pctA}%`,
                ["--pill-tint" as string]: segmentTint(pctA),
              }}
            />
            <div
              className={classes.winSegment}
              style={{
                width: `${pctB}%`,
                ["--pill-tint" as string]: segmentTint(pctB),
              }}
            />
          </div>
          <span>{loaded && winProbA !== null ? `${pctB}%` : "–"}</span>
        </div>
      )}
    </div>
  );
}
