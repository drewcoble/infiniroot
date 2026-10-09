import type { GlassMatchupCardData } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// A card's game line, rendered inside a .gameLine flex row. Normally one
// truncating line - "vs. KC · Sun 1:00 PM". While the game is live, the
// matchup stays left and the clock sits at the row's right edge in the
// dot-matrix scoreboard font ("vs. KC ... Q3 2:58"), the gap standing in
// for the "·". `prefix` (the detail card's NFL team) leads the matchup.
// `hideLiveClock`: the card shows the clock elsewhere (the Matchup card's
// top row), so a live line is just the matchup.
export function GameLineText({
  data,
  prefix,
  hideLiveClock = false,
}: {
  data: GlassMatchupCardData;
  prefix?: string;
  hideLiveClock?: boolean;
}) {
  const matchup = prefix ? `${prefix} ${data.matchup}` : data.matchup;
  if (data.gameState === "live" && data.status) {
    if (hideLiveClock) return <span className={classes.gameLineText}>{matchup}</span>;
    return (
      <>
        <span className={classes.gameLineText}>{matchup}</span>
        <span className={classes.liveClock}>{data.status}</span>
      </>
    );
  }
  return (
    <span className={classes.gameLineText}>
      {data.status ? `${matchup} · ${data.status}` : matchup}
    </span>
  );
}
