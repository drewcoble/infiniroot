import { useState } from "react";
import type { Position } from "@shared/positionColors";
import classes from "./GlassMatchupCard.module.css";

// Sleeper's CDN, keyed by Sleeper's player_id - which is our fpid (see the
// players table in infinidata/convex/schema.ts), so no extra id to thread
// through. The files are transparent PNGs (despite the .jpg), so they sit
// on the glass without a white box. DST fpids are our own synthetic ids
// with no Sleeper player behind them, so a defense shows its team logo.
const HEADSHOT_URL = "https://sleepercdn.com/content/nfl/players/thumb";
const TEAM_LOGO_URL = "https://sleepercdn.com/images/team_logos/nfl";

function headshotSrc(fpid: number, position: Position, team: string | null): string | null {
  if (position === "DST") return team ? `${TEAM_LOGO_URL}/${team.toLowerCase()}.png` : null;
  return `${HEADSHOT_URL}/${fpid}.jpg`;
}

// The headshot well at the left of the full-width player cards (roster,
// Players board, Free Agents), and larger at the head of every single-player
// detail popover (see .expandedHeader). Small elsewhere: at the start of
// the line under the name on the half-width cards - Matchup, Trade, Buys /
// Sells (.headshotInline). 4:3 throughout, like the photos themselves. Decorative - the card's label
// already names the player. A missing photo (Sleeper 403s an unknown id) or an empty slot
// leaves the bare glass well, so every card keeps its shape.
export function PlayerHeadshot({
  fpid,
  position,
  team,
  className,
}: {
  fpid: number | undefined;
  position: Position;
  team: string | null;
  className?: string | undefined;
}) {
  const src = fpid === undefined ? null : headshotSrc(fpid, position, team);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isLogo = position === "DST";

  return (
    <span className={className ? `${classes.headshot} ${className}` : classes.headshot} aria-hidden>
      {src && src !== failedSrc && (
        <img
          src={src}
          alt=""
          className={isLogo ? classes.headshotLogo : classes.headshotImg}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  );
}
