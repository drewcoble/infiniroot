import { ArrowDown, ArrowUp } from "lucide-react";
import classes from "./GlassMatchupCard.module.css";

// Where this team lands in the league's power rankings if the trade goes
// through (see trade.tsx's getPowerRankingsWithTrade call).
export interface TradeImpactSide {
  beforeRank: number | undefined;
  afterRank: number;
  // Rest-of-season optimal-lineup points, after minus before.
  pointsDiff: number | undefined;
}

export interface TradeHeaderTeam {
  name: string;
  // Players this team gives up, and their combined rest-of-season PPG.
  sendCount: number;
  sendRosPpg: number;
  // undefined = no impact to show yet (a side has nothing selected);
  // "loading" = being computed.
  impact: TradeImpactSide | "loading" | undefined;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function impactText(team: TradeHeaderTeam): string {
  if (team.impact === undefined || team.impact === "loading") return "";
  const { beforeRank, afterRank, pointsDiff } = team.impact;
  const rank =
    beforeRank === undefined || beforeRank === afterRank
      ? `stays power rank ${afterRank}`
      : `power rank ${beforeRank} to ${afterRank}`;
  return pointsDiff !== undefined ? `${rank}, ${signed(pointsDiff)} points` : rank;
}

function Impact({ impact }: { impact: TradeHeaderTeam["impact"] }) {
  if (impact === undefined) return <div className={classes.headerProj} />;
  if (impact === "loading") {
    return <span className={classes.skeletonBar} style={{ width: "58%", height: 12 }} />;
  }
  const { beforeRank, afterRank, pointsDiff } = impact;
  const move = beforeRank !== undefined ? beforeRank - afterRank : 0;
  return (
    <div className={`${classes.headerProj} ${classes.tradeHeaderImpact}`}>
      <span className={classes.headerCount}>
        {move !== 0 && beforeRank !== undefined && <>#{beforeRank} → </>}#{afterRank}
        {move > 0 && <ArrowUp size={12} strokeWidth={3} className={classes.impactUp} />}
        {move < 0 && <ArrowDown size={12} strokeWidth={3} className={classes.impactDown} />}
      </span>
      {pointsDiff !== undefined && (
        <span
          className={
            pointsDiff > 0 ? classes.impactUp : pointsDiff < 0 ? classes.impactDown : undefined
          }
        >
          {signed(pointsDiff)} pts
        </span>
      )}
    </div>
  );
}

function TeamSide({ team, align }: { team: TradeHeaderTeam; align: "left" | "right" }) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      <div className={classes.headerTeamName}>{team.name}</div>
      <div className={classes.headerTotal}>
        {team.sendCount > 0 ? team.sendRosPpg.toFixed(1) : "—"}
      </div>
      <div className={classes.tradeHeaderSends}>
        {team.sendCount > 0 ? `Sends ${team.sendCount} · ROS PPG` : "Tap players to send"}
      </div>
      <Impact impact={team.impact} />
    </div>
  );
}

function TeamSideSkeleton({ align }: { align: "left" | "right" }) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      <span className={classes.skeletonBar} style={{ width: "70%", height: 14 }} />
      <span className={classes.skeletonBar} style={{ width: "40%", height: 28, marginTop: 4 }} />
      <span className={classes.skeletonBar} style={{ width: "52%", height: 11, marginTop: 4 }} />
      <span />
    </div>
  );
}

// Trade tab's header in the Matchup header's glass and two-column layout:
// each side's team name, the rest-of-season PPG it sends (the big number),
// how many players that is, and - once both sides have picked players -
// where the trade leaves the team in the power rankings. `teamB` null = no
// trade partner picked yet (dimmed placeholder, like the Matchup header's
// missing opponent).
export function GlassTradeHeader({
  teamA,
  teamB,
}: {
  teamA: TradeHeaderTeam | "loading";
  teamB: TradeHeaderTeam | "loading" | null;
}) {
  const teamText = (team: TradeHeaderTeam) =>
    [
      team.name,
      team.sendCount > 0
        ? `sends ${team.sendCount} players, ${team.sendRosPpg.toFixed(1)} rest-of-season PPG`
        : "no players selected",
      impactText(team),
    ]
      .filter(Boolean)
      .join(", ");
  const ariaLabel =
    teamA === "loading"
      ? "Loading trade"
      : teamB === "loading" || teamB === null
        ? teamText(teamA)
        : `${teamText(teamA)}; ${teamText(teamB)}`;
  return (
    <div
      className={`${classes.card} ${classes.header}`}
      role="group"
      aria-label={ariaLabel}
      aria-busy={teamA === "loading" || teamB === "loading"}
    >
      <div className={`${classes.headerTeams} ${classes.tradeHeaderTeams}`} aria-hidden>
        {teamA === "loading" ? (
          <TeamSideSkeleton align="left" />
        ) : (
          <TeamSide team={teamA} align="left" />
        )}
        {teamB === "loading" ? (
          <TeamSideSkeleton align="right" />
        ) : teamB ? (
          <TeamSide team={teamB} align="right" />
        ) : (
          <div
            className={`${classes.headerTeam} ${classes.headerTeamRight} ${classes.headerPending}`}
          >
            <div className={classes.headerTeamName}>Trade partner</div>
            <div className={classes.headerTotal}>—</div>
            <div className={classes.tradeHeaderSends}>Pick a team</div>
            <span />
          </div>
        )}
      </div>
    </div>
  );
}
