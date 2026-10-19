// PLACEHOLDER usage scores for the Simple mode chart sandbox - computed
// client-side from a player's game log (convex/infinileague/season/
// gameLog.ts) so the charts can be judged against real seasons before the
// real formulas exist. Not calibrated: the weights and the "elite week"
// benchmarks below are rough guesses. The real scores belong server-side
// (see the simple-mode plan), keyed by player and week, independent of any
// league's scoring settings.

export type UsagePosition = "QB" | "RB" | "WR" | "TE";

export interface GameLogLike {
  columns: Array<{ key: string }>;
  weeks: Array<{
    week: number;
    kind: "played" | "dnp" | "bye";
    points: number | null;
    positionRank: number | null;
    values: Array<number | null>;
  }>;
}

// One week's usage, each part on the same 0-100-ish scale so they add up
// to the total (an elite week ~100; a monster week can pass it).
export interface UsageWeek {
  week: number;
  kind: "played" | "dnp" | "bye";
  pass: number;
  rush: number;
  rec: number;
  total: number;
  // The raw opportunity stats behind the score, for the readout.
  inputs: {
    passAtt: number;
    passRzAtt: number;
    rushAtt: number;
    rushRzAtt: number;
    targets: number;
    rzTargets: number;
    airYards: number;
    snapPct: number | null;
  };
}

// Opportunity units per stat - red-zone looks count extra on top of the
// carry/target they already are, since they're worth more touchdowns.
const WEIGHTS = {
  passAtt: 0.2,
  passRzAtt: 0.6,
  rushAtt: 1,
  rushRzAtt: 1.5,
  target: 1.6,
  rzTarget: 2,
  airYard: 0.02,
};

// Units in a top-tier week at each position - that week scores 100.
const ELITE_UNITS: Record<UsagePosition, number> = { QB: 20, RB: 30, WR: 26, TE: 20 };

export function isUsagePosition(position: string): position is UsagePosition {
  return position === "QB" || position === "RB" || position === "WR" || position === "TE";
}

export function usageWeeks(log: GameLogLike, position: UsagePosition): UsageWeek[] {
  const index = new Map(log.columns.map((column, columnIndex) => [column.key, columnIndex]));
  const elite = ELITE_UNITS[position];
  return log.weeks.map((week) => {
    const read = (key: string) => {
      const columnIndex = index.get(key);
      return columnIndex === undefined ? 0 : (week.values[columnIndex] ?? 0);
    };
    const snapIndex = index.get("snap_pct");
    const inputs = {
      passAtt: read("pass_att"),
      passRzAtt: read("pass_rz_att"),
      rushAtt: read("rush_att"),
      rushRzAtt: read("rush_rz_att"),
      targets: read("rec_tgt"),
      rzTargets: read("rec_rz_tgt"),
      airYards: read("rec_air_yd"),
      snapPct: snapIndex === undefined ? null : (week.values[snapIndex] ?? null),
    };
    const score = (units: number) => Math.round((units / elite) * 100);
    const pass = score(inputs.passAtt * WEIGHTS.passAtt + inputs.passRzAtt * WEIGHTS.passRzAtt);
    const rush = score(inputs.rushAtt * WEIGHTS.rushAtt + inputs.rushRzAtt * WEIGHTS.rushRzAtt);
    const rec = score(
      inputs.targets * WEIGHTS.target +
        inputs.rzTargets * WEIGHTS.rzTarget +
        Math.max(inputs.airYards, 0) * WEIGHTS.airYard,
    );
    return { week: week.week, kind: week.kind, pass, rush, rec, total: pass + rush + rec, inputs };
  });
}

export type Trend = "up" | "steady" | "down";

// Last three games played vs. the season's average - "steady" within 10%
// either way (and never on fewer than four games, where there's no season
// to compare against yet).
export function usageTrend(
  weeks: UsageWeek[],
): { trend: Trend; recent: number; season: number } | null {
  const played = weeks.filter((week) => week.kind === "played");
  if (played.length === 0) return null;
  const average = (list: UsageWeek[]) =>
    list.reduce((sum, week) => sum + week.total, 0) / list.length;
  const season = average(played);
  const recent = average(played.slice(-3));
  if (played.length < 4) return { trend: "steady", recent, season };
  const trend = recent > season * 1.1 ? "up" : recent < season * 0.9 ? "down" : "steady";
  return { trend, recent, season };
}
