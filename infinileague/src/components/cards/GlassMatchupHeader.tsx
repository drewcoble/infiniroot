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
const TOSSUP_MARGIN = 5;
const FAVORED_TINT = "#4ade80";
const UNDERDOG_TINT = "#f87171";
const TOSSUP_TINT = "#f8fafc";

function segmentTint(pct: number): string {
  if (pct > 50 + TOSSUP_MARGIN) return FAVORED_TINT;
  if (pct < 50 - TOSSUP_MARGIN) return UNDERDOG_TINT;
  return TOSSUP_TINT;
}

function TeamSide({ team, align }: { team: MatchupHeaderTeam; align: "left" | "right" }) {
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
        {team.liveCount === 0 && team.toPlayCount === 0 && <span>Final</span>}
      </div>
    </div>
  );
}

function countsText(team: MatchupHeaderTeam): string {
  if (team.liveCount === 0 && team.toPlayCount === 0) return "all games final";
  return `${team.liveCount} live, ${team.toPlayCount} to play`;
}

// Glass version of the Matchup tab's score header: both teams' scores,
// live projections, how many starters are still live / yet to play, and
// the win-probability split. `winProbA` is team A's 0-1 share. No "VS" or
// "Win probability" caption - the facing columns and the split bar with a
// percentage at each end say both.
export function GlassMatchupHeader({
  teamA,
  teamB,
  winProbA,
}: {
  teamA: MatchupHeaderTeam;
  teamB: MatchupHeaderTeam;
  winProbA: number;
}) {
  const pctA = Math.round(winProbA * 100);
  const pctB = 100 - pctA;
  return (
    <div
      className={`${classes.card} ${classes.header}`}
      role="group"
      aria-label={
        `${teamA.name} ${teamA.actualPoints.toFixed(2)}, projected ${teamA.projectedPoints.toFixed(1)}, ${countsText(teamA)}; ` +
        `${teamB.name} ${teamB.actualPoints.toFixed(2)}, projected ${teamB.projectedPoints.toFixed(1)}, ${countsText(teamB)}; ` +
        `win probability ${pctA}% to ${pctB}%`
      }
    >
      <div className={classes.headerTeams} aria-hidden>
        <TeamSide team={teamA} align="left" />
        <TeamSide team={teamB} align="right" />
      </div>

      <div className={classes.winRow} aria-hidden>
        <span>{pctA}%</span>
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
        <span>{pctB}%</span>
      </div>
    </div>
  );
}
