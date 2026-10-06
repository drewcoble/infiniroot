import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@infinidata/api";

// One team's game this week - see convex/sleeper/livePoints.ts's
// getWeekGames. Keyed by our own (Sleeper) team codes, same as every
// player's `team`.
export type WeekGame = FunctionReturnType<typeof api.sleeper.livePoints.getWeekGames>[number];

// Same window the live poll treats a game as live for (kickoff + 4.5h, see
// convex/sleeper/livePoints.ts) - used only when the poll hasn't recorded
// a status for a game yet, to tell "kicked off, waiting on first poll"
// from "long since over".
const GAME_WINDOW_MS = 4.5 * 60 * 60 * 1000;

// Share of a team's game still to play, 0-1: what a pregame projection is
// scaled by for its live projection. A team with no game this week (bye)
// has nothing left to play.
export function remainingFraction(game: WeekGame | undefined, now: number): number {
  if (!game) return 0;
  if (game.live) return game.live.remainingFraction;
  if (now > game.kickoffAt + GAME_WINDOW_MS) return 0;
  return 1;
}

// Whether this team's game is underway right now (kicked off, not final).
export function isGameInProgress(game: WeekGame | undefined, now: number): boolean {
  if (!game) return false;
  if (game.live) return game.live.state === "in";
  return now >= game.kickoffAt && now <= game.kickoffAt + GAME_WINDOW_MS;
}

// Whether any game is being played right now - drives the Matchup tab's
// periodic roster refresh. A kicked-off game with no status yet still
// counts, so the refresh starts on time even before the first poll lands.
export function isAnyGameLive(games: WeekGame[] | undefined, now: number): boolean {
  return (games ?? []).some((game) => isGameInProgress(game, now));
}

// Points so far plus the not-yet-played share of the pregame projection -
// equals the projection before kickoff and the actual score once final.
export function liveProjection(
  projected: number | undefined,
  actual: number | undefined,
  fraction: number,
): number {
  return (actual ?? 0) + (projected ?? 0) * fraction;
}

const KICKOFF_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function formatClock(seconds: number): string {
  const whole = Math.max(Math.floor(seconds), 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// "vs. LAR · Sun 1:00 PM" before kickoff, "@ HOU · Q3 8:12" during,
// "@ HOU · Final" after. Kickoff time is in the viewer's own time zone.
export function formatGameLine(game: WeekGame, now: number): string {
  const matchup = game.isHome ? `vs. ${game.opponent}` : `@ ${game.opponent}`;
  const live = game.live;
  let status: string;
  if (live?.state === "in") {
    if (live.statusName === "STATUS_HALFTIME") status = "Half";
    else if (live.period > 4) status = `OT ${formatClock(live.clockSeconds)}`;
    else status = `Q${live.period} ${formatClock(live.clockSeconds)}`;
  } else if (live?.state === "post" || (!live && now > game.kickoffAt + GAME_WINDOW_MS)) {
    status = "Final";
  } else {
    status = KICKOFF_FORMAT.format(new Date(game.kickoffAt));
  }
  return `${matchup} · ${status}`;
}

// Current time, re-read every `intervalMs` - so kickoff-based states (a
// game crossing its kickoff, or its window closing) update on their own
// without waiting for a data change.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
