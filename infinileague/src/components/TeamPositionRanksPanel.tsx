import { gradeColor } from "../lib/gradeColor";
import type { TeamPositionRanks } from "../types/season";
import { pillStyle } from "./cards/cardShared";
import { PositionRadarChart } from "./PositionRadarChart";
import classes from "./cards/GlassMatchupCard.module.css";

interface TeamPositionRanksPanelProps {
  // undefined while getTeamPositionRanks is still loading - the shared fetch
  // backs every team's card (see the league index page).
  positionRanks: TeamPositionRanks | undefined;
  totalTeams: number;
}

// Position-strength section of the league-home team popover (GlassTeamCard)
// - a numeric 0-100 score (not a letter grade, per the dashboard's own
// convention) as a glass badge colored the way infinidraft's report card
// colors its grades, plus the position radar chart.
export function TeamPositionRanksPanel({ positionRanks, totalTeams }: TeamPositionRanksPanelProps) {
  return (
    <div>
      <div className={classes.strengthHeader}>
        <span className={classes.strengthLabel}>Position strength</span>
        {positionRanks ? (
          <span
            className={classes.pill}
            style={{
              ...pillStyle(gradeColor(positionRanks.gradeScore)),
              fontFamily: "var(--font-numeric)",
            }}
          >
            {positionRanks.gradeScore}
          </span>
        ) : (
          <span className={classes.skeletonBar} style={{ width: 32, height: 20 }} />
        )}
      </div>
      {positionRanks ? (
        <PositionRadarChart
          positionalRanks={positionRanks.positionalRanks}
          totalTeams={totalTeams}
          gradeScore={positionRanks.gradeScore}
        />
      ) : (
        <span
          className={classes.skeletonBar}
          style={{ height: 200, marginTop: 8, borderRadius: 16 }}
        />
      )}
    </div>
  );
}
