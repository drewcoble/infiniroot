import { v, type Infer } from "convex/values";

// One NFL game's live status, from ESPN's public scoreboard (see
// espn/scoreboard.ts) - stored per team on the week's liveWeekPoints
// document by the live poll (sleeper/livePoints.ts). `team` is always in
// our own (Sleeper) team codes - see normalizeNflTeam.
export const liveGameValidator = v.object({
  team: v.string(),
  state: v.union(v.literal("pre"), v.literal("in"), v.literal("post")),
  period: v.number(),
  // Seconds left in the current period.
  clockSeconds: v.number(),
  // ESPN's status name, e.g. "STATUS_IN_PROGRESS", "STATUS_HALFTIME",
  // "STATUS_END_PERIOD", "STATUS_FINAL" - only used to label halftime.
  statusName: v.string(),
});
export type LiveGame = Infer<typeof liveGameValidator>;

// Tank01 (nflGames) and ESPN both spell Washington "WSH"; Sleeper - which
// every player's `team` comes from - spells it "WAS". Everything else
// matches across all three (checked against a full week of each).
export function normalizeNflTeam(code: string): string {
  return code === "WSH" ? "WAS" : code;
}

const REGULATION_SECONDS = 4 * 15 * 60;

// Share of regulation still to play, 0-1 - what a pregame projection gets
// scaled by for live projections. Overtime counts as 0 (any further points
// land in actual points, there's no meaningful "projected" share of an OT).
export function remainingFraction(game: Pick<LiveGame, "state" | "period" | "clockSeconds">): number {
  if (game.state === "pre") return 1;
  if (game.state === "post" || game.period > 4) return 0;
  const remaining = (4 - game.period) * 15 * 60 + game.clockSeconds;
  return Math.min(Math.max(remaining / REGULATION_SECONDS, 0), 1);
}
