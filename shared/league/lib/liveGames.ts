import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@infinidata/api";
import type { AllowedTier, DstLiveScoring, TeamRosterRow } from "../types/season";

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
// Defenses don't accumulate like that - see dstLiveProjection.
export function liveProjection(
  row: Pick<TeamRosterRow, "projectedPoints" | "actualPoints" | "position" | "dstScoring">,
  fraction: number,
): number {
  const actual = row.actualPoints ?? 0;
  const projected = row.projectedPoints ?? 0;
  if (row.position === "DST") {
    return dstLiveProjection(projected, actual, fraction, row.dstScoring);
  }
  return actual + projected * fraction;
}

// How far a real game strays from the projected allowed totals - one
// standard deviation over a full game, same as convex/lib/dstScoring.ts's
// pregame projection; the remaining share's spread shrinks with the square
// root of what's left.
const POINTS_ALLOWED_SD = 10;
const YARDS_ALLOWED_SD = 75;

function tierPoints(tiers: AllowedTier[], allowed: number): number {
  const tier = tiers.find(
    (candidate) =>
      allowed >= candidate.min && (candidate.max === null || allowed <= candidate.max),
  );
  return tier?.points ?? 0;
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7).
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Expected tier points for a final total of `soFar` plus whatever is still
// allowed, that rest taken as normal(mean, sd) - floored at zero, since a
// defense can't un-allow points, so the below-zero tail all lands in the
// tier `soFar` already sits in. Tiers are whole numbers, hence the ±0.5.
function expectedTierPoints(
  tiers: AllowedTier[],
  soFar: number,
  mean: number,
  sd: number,
): number {
  if (sd < 1e-6) return tierPoints(tiers, soFar + mean);
  const cdf = (finalTotal: number) => normalCdf((finalTotal - soFar - mean) / sd);
  return tiers.reduce((total, tier) => {
    if (tier.max !== null && tier.max < soFar) return total;
    const low = tier.min <= soFar ? 0 : cdf(tier.min - 0.5);
    const high = tier.max === null ? 1 : cdf(tier.max + 0.5);
    return total + tier.points * Math.max(high - low, 0);
  }, 0);
}

// A defense's score starts at its league's full "0 points allowed" bonus
// and drops tier by tier as the offense it faces scores (and, in leagues
// that score it, gains yards), while sacks, takeaways and return TDs only
// ever add to it. So it's modeled as two parts: what's been banked from
// those plays plus the unplayed share of their projection, and the
// expected allowed-tier points given what's been allowed so far and the
// unplayed share of the projected total - 14 points allowed by halftime
// has already cost the shutout tiers for good, with half a game left to
// slip further. The server's projection (convex/lib/dstScoring.ts's
// dstProjection) is the same model at kickoff, so this equals it then and
// the actual score once final.
//
// Without the league's scoring or live allowed totals (an unreadable
// settings shape, a pruned past week), falls back to sliding from the
// projection toward the current score as the game is played.
function dstLiveProjection(
  projected: number,
  actual: number,
  fraction: number,
  scoring: DstLiveScoring | undefined,
): number {
  if (fraction <= 0) return actual;
  if (!scoring?.allowed) return actual * (1 - fraction) + projected * fraction;

  const { points, yards } = scoring.allowed;
  const spread = Math.sqrt(fraction);
  const bankedPlays = Math.max(
    actual - tierPoints(scoring.pointsTiers, points) - tierPoints(scoring.yardsTiers, yards),
    0,
  );
  return (
    bankedPlays +
    scoring.projectedPlays * fraction +
    expectedTierPoints(
      scoring.pointsTiers,
      points,
      scoring.projectedPointsAllowed * fraction,
      POINTS_ALLOWED_SD * spread,
    ) +
    expectedTierPoints(
      scoring.yardsTiers,
      yards,
      scoring.projectedYardsAllowed * fraction,
      YARDS_ALLOWED_SD * spread,
    )
  );
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

// Whether this team's game is over - ESPN says final, or (no status yet)
// its live window has long since closed.
export function isGameFinal(game: WeekGame, now: number): boolean {
  if (game.live) return game.live.state === "post";
  return now > game.kickoffAt + GAME_WINDOW_MS;
}

// "vs. LAR" at home, "@ HOU" away.
export function formatMatchup(game: WeekGame): string {
  return game.isHome ? `vs. ${game.opponent}` : `@ ${game.opponent}`;
}

// "Sun 1:00 PM" before kickoff, "Q3 8:12" / "Half" / "OT 4:02" during,
// "Final" after. Kickoff time is in the viewer's own time zone.
export function formatGameStatus(game: WeekGame, now: number): string {
  const live = game.live;
  if (live?.state === "in") {
    if (live.statusName === "STATUS_HALFTIME") return "Half";
    if (live.period > 4) return `OT ${formatClock(live.clockSeconds)}`;
    return `Q${live.period} ${formatClock(live.clockSeconds)}`;
  }
  if (isGameFinal(game, now)) return "Final";
  return KICKOFF_FORMAT.format(new Date(game.kickoffAt));
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
