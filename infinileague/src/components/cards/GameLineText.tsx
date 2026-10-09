import type { GlassMatchupCardData } from "./cardShared";
import classes from "./GlassMatchupCard.module.css";

// A card's game line - "vs. KC · Q3 2:58". While the game is live, the
// clock is set in the dot-matrix scoreboard font (see .liveClock), like the
// scores; otherwise it's plain text, same as gameLine().
export function GameLineText({ data }: { data: GlassMatchupCardData }) {
  if (!data.status) return <>{data.matchup}</>;
  return (
    <>
      {data.matchup} ·{" "}
      <span className={data.gameState === "live" ? classes.liveClock : undefined}>
        {data.status}
      </span>
    </>
  );
}
