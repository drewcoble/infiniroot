import { formatMatchupFactor } from "../../lib/matchupDifficulty";
import type { GlassMatchupCardData } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// A card's game line, rendered inside a .gameLine flex row. Normally one
// truncating line - "vs. KC · Sun 1:00 PM". While the game is live, the
// matchup stays left and the clock sits at the row's right edge in the
// dot-matrix scoreboard font ("vs. KC ... Q3 2:58"), the gap standing in
// for the "·". `prefix` (the detail card's NFL team) leads the matchup.
// `statusInTopRow`: the card shows a live clock / "FINAL" in its top row
// instead, so a live or finished game's line is just the matchup.
// An easy/hard matchup grade colors the opponent green/red and adds its
// number ("vs. KC +5%"); a neutral one leaves the line as-is.
export function GameLineText({
  data,
  prefix,
  statusInTopRow = false,
}: {
  data: GlassMatchupCardData;
  prefix?: string;
  statusInTopRow?: boolean;
}) {
  const grade = data.matchupGrade?.tier !== "neutral" ? data.matchupGrade : undefined;
  const matchup = (
    <>
      {prefix ? `${prefix} ` : ""}
      {grade ? (
        <span className={classes[`matchup_${grade.tier}`]}>
          {data.matchup} {formatMatchupFactor(grade.factor)}
        </span>
      ) : (
        data.matchup
      )}
    </>
  );
  if (statusInTopRow && (data.gameState === "live" || data.gameState === "final")) {
    return <span className={classes.gameLineText}>{matchup}</span>;
  }
  if (data.gameState === "live" && data.status) {
    return (
      <>
        <span className={classes.gameLineText}>{matchup}</span>
        <span className={classes.liveClock}>{data.status}</span>
      </>
    );
  }
  return (
    <span className={classes.gameLineText}>
      {matchup}
      {data.status ? ` · ${data.status}` : ""}
    </span>
  );
}
