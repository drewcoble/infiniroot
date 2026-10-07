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

// My Team's header in the same glass as the Matchup header and roster cards:
// team name with a FAAB / waiver-order badge, the season line (rank,
// record, points for/against), then a week section - which week it is, the
// starters' live/to-play counts, and the week's score with its projection
// (the week itself is picked from the page's title row - see WeekPicker). `team` undefined = standings still loading (skeleton);
// `summary` undefined = the week's roster still loading. Before any starter
// has kicked off there's no score yet, so the projection takes the score's
// place, small - same rule as the player cards.
export function GlassTeamHeader({
  team,
  week,
  summary,
}: {
  team: StandingsRow | undefined;
  week: number | null;
  summary: TeamWeekSummary | undefined;
}) {
  const notStarted =
    summary !== undefined &&
    summary.liveCount === 0 &&
    summary.toPlayCount > 0 &&
    summary.actualPoints === 0;
  const allFinal = summary !== undefined && summary.liveCount === 0 && summary.toPlayCount === 0;

  return (
    <div className={`${classes.card} ${classes.header}`} aria-busy={team === undefined}>
      {team === undefined ? (
        <div aria-hidden>
          <span className={classes.skeletonBar} style={{ width: "55%", height: 18 }} />
          <span
            className={classes.skeletonBar}
            style={{ width: "75%", height: 12, marginTop: 8 }}
          />
        </div>
      ) : (
        <div>
          <div className={classes.teamHeaderTop}>
            <h3 className={classes.teamHeaderName}>{team.name}</h3>
            <span
              className={classes.pill}
              style={{
                color: "#f8fafc",
                ["--pill-tint" as string]: "var(--mantine-color-gray-5)",
              }}
            >
              {team.faabRemaining !== undefined
                ? `$${team.faabRemaining} FAAB`
                : `Waiver #${team.waiverPosition ?? "—"}`}
            </span>
          </div>
          <div className={classes.teamHeaderSeason}>
            #{team.rank} · {team.wins}-{team.losses}-{team.ties} · {team.pointsFor.toFixed(1)} PF ·{" "}
            {team.pointsAgainst.toFixed(1)} PA
          </div>
        </div>
      )}

      <div className={classes.teamHeaderDivider} aria-hidden />

      <div className={classes.teamHeaderWeek}>
        <span className={classes.teamHeaderWeekLabel}>{week !== null ? `Week ${week}` : ""}</span>
        {summary && (
          <div
            className={classes.headerProj}
            aria-label={
              allFinal
                ? "All games final"
                : `${summary.liveCount} live, ${summary.toPlayCount} to play`
            }
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
            {allFinal && <span>Final</span>}
          </div>
        )}
      </div>

      {summary === undefined ? (
        <div className={classes.teamHeaderScore} aria-hidden>
          <span className={classes.skeletonBar} style={{ width: 110, height: 28 }} />
          <span className={classes.skeletonBar} style={{ width: 72, height: 12 }} />
        </div>
      ) : (
        <div className={classes.teamHeaderScore}>
          <span className={classes.headerTotal}>
            {notStarted ? "" : summary.actualPoints.toFixed(2)}
          </span>
          <span className={classes.headerProj}>Proj {summary.projectedPoints.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}
