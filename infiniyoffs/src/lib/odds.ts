import { evaluate, type SeasonInput } from "@playoffRules/evaluate";
import type { PlayoffFormat } from "@playoffRules/format";
import { lastFormatWeek } from "./engineInput";

// Monte Carlo playoff odds: every unplayed week is drawn around each team's
// projection, the whole format is played out, and the outcomes tallied.
// Undecided matchup-draft picks go to the drafter's weakest option.

// A team's weekly score spread as a share of its projection - the same
// figure infinileague's projected standings use.
const SCORE_SD_SHARE = 0.2;

export interface TeamOdds {
  teamId: string;
  // Averages over every run - the projected final regular season.
  wins: number;
  losses: number;
  pointsFor: number;
  seed: number;
  // Chance of finishing in each tier.
  tiers: Record<string, number>;
  // Chance of playing in the championship stage, and of winning it.
  playoffs: number;
  title: number;
}

export interface OddsRequest {
  format: PlayoffFormat;
  input: SeasonInput;
  // teamId -> week -> projected points, this week on.
  projected: Record<string, Record<number, number>>;
  runs: number;
}

function normal(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export function simulateOdds({ format, input, projected, runs }: OddsRequest): TeamOdds[] {
  const lastWeek = lastFormatWeek(format);
  const firstOpen = input.finalThroughWeek + 1;

  // Each team's mean for every open week: its projection (never below the
  // points it already has live), else its average so far.
  const means = new Map<string, Record<number, number>>();
  const strength: Record<string, number> = {};
  for (const teamId of input.teamIds) {
    const played = Object.entries(input.points[teamId] ?? {})
      .filter(([week]) => Number(week) < firstOpen)
      .map(([, points]) => points);
    const average = played.length ? played.reduce((a, b) => a + b, 0) / played.length : 100;
    const byWeek: Record<number, number> = {};
    for (let week = firstOpen; week <= lastWeek; week++) {
      const projection = projected[teamId]?.[week] ?? average;
      byWeek[week] = Math.max(projection, input.points[teamId]?.[week] ?? 0);
    }
    means.set(teamId, byWeek);
    strength[teamId] = Object.values(byWeek).reduce((a, b) => a + b, 0) || average;
  }

  const championship = format.stages.find((s) => s.id === format.championshipStageId);
  const tally = new Map(
    input.teamIds.map((teamId) => [
      teamId,
      {
        wins: 0,
        losses: 0,
        pointsFor: 0,
        seed: 0,
        tiers: {} as Record<string, number>,
        playoffs: 0,
        title: 0,
      },
    ]),
  );

  for (let run = 0; run < runs; run++) {
    const points: Record<string, Record<number, number>> = {};
    for (const teamId of input.teamIds) {
      const sampled = { ...input.points[teamId] };
      for (const [week, mean] of Object.entries(means.get(teamId)!)) {
        sampled[Number(week)] = Math.max(0, mean + normal() * SCORE_SD_SHARE * mean);
      }
      points[teamId] = sampled;
    }
    const state = evaluate(format, {
      ...input,
      points,
      finalThroughWeek: lastWeek,
      autoPick: { strength },
    });
    for (const row of state.standings) {
      const t = tally.get(row.teamId)!;
      t.wins += row.wins;
      t.losses += row.losses;
      t.pointsFor += row.pointsFor;
      t.seed += row.seed;
      if (row.tier) t.tiers[row.tier] = (t.tiers[row.tier] ?? 0) + 1;
    }
    for (const teamId of (championship && state.stages[championship.id]?.entrants) ?? []) {
      tally.get(teamId)!.playoffs++;
    }
    if (state.championId) tally.get(state.championId)!.title++;
  }

  return [...tally].map(([teamId, t]) => ({
    teamId,
    wins: t.wins / runs,
    losses: t.losses / runs,
    pointsFor: t.pointsFor / runs,
    seed: t.seed / runs,
    tiers: Object.fromEntries(Object.entries(t.tiers).map(([tier, n]) => [tier, n / runs])),
    playoffs: t.playoffs / runs,
    title: t.title / runs,
  }));
}
