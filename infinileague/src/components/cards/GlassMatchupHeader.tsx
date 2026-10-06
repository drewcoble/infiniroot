import { POSITION_COLORS } from "@shared/positionColors";
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

// Same team colors the current Matchup tab's win-probability bar uses
// (matchup.tsx's WIN_PROB_COLOR_A/B), as glass tints rather than solid fills.
const TEAM_A_COLOR = POSITION_COLORS.RB;
const TEAM_B_COLOR = POSITION_COLORS.DST;

function TeamSide({ team, align }: { team: MatchupHeaderTeam; align: "left" | "right" }) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      <div className={classes.headerTeamName}>{team.name}</div>
      <div className={classes.headerTotal}>{team.actualPoints.toFixed(2)}</div>
      <div className={classes.headerProj}>Proj {team.projectedPoints.toFixed(1)}</div>
      {/* Same icons as the player cards' corners, so "how much is left"
          reads in the same vocabulary. */}
      <div className={classes.headerCounts}>
        {team.liveCount > 0 && (
          <span className={classes.headerCount}>
            <GameStatusGlyph state="live" />
            {team.liveCount} live
          </span>
        )}
        {team.toPlayCount > 0 && (
          <span className={classes.headerCount}>
            <GameStatusGlyph state="pre" />
            {team.toPlayCount} to play
          </span>
        )}
        {team.liveCount === 0 && team.toPlayCount === 0 && (
          <span className={classes.headerCount}>All final</span>
        )}
      </div>
    </div>
  );
}

// Glass version of the Matchup tab's score header: both teams' scores,
// live projections, how many starters are still live / yet to play, and
// the win-probability split. `winProbA` is team A's 0-1 share.
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
        `${teamA.name} ${teamA.actualPoints.toFixed(2)}, projected ${teamA.projectedPoints.toFixed(1)}; ` +
        `${teamB.name} ${teamB.actualPoints.toFixed(2)}, projected ${teamB.projectedPoints.toFixed(1)}; ` +
        `win probability ${pctA}% to ${pctB}%`
      }
    >
      <div className={classes.headerTeams} aria-hidden>
        <TeamSide team={teamA} align="left" />
        <div className={classes.headerVs}>VS</div>
        <TeamSide team={teamB} align="right" />
      </div>

      <div aria-hidden>
        <div className={classes.winLabels}>
          <span>{pctA}%</span>
          <span className={classes.winCaption}>Win probability</span>
          <span>{pctB}%</span>
        </div>
        <div className={classes.winBar}>
          <div
            className={classes.winSegment}
            style={{
              width: `${pctA}%`,
              ["--pill-tint" as string]: `var(--mantine-color-${TEAM_A_COLOR}-5)`,
            }}
          />
          <div
            className={classes.winSegment}
            style={{
              width: `${pctB}%`,
              ["--pill-tint" as string]: `var(--mantine-color-${TEAM_B_COLOR}-5)`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
