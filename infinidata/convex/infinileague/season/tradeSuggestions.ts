import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { api } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { POSITIONS } from "../../positions";
import { gatherPowerRankingsInputs, type PowerRankingsInputs } from "./powerRankings";
import { adjustedTradeTotals, loadTradeValues } from "./tradeValues";

type Position = (typeof POSITIONS)[number];

export interface TradeSuggestionPlayer {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
}

export interface TradeSuggestion {
  partnerTeamId: Id<"seasonTeams">;
  partnerName: string;
  // From your side's point of view: who you give up, who you get.
  send: TradeSuggestionPlayer[];
  receive: TradeSuggestionPlayer[];
  // Rest-of-season optimal-lineup points, after minus before - the same
  // total getPowerRankingsWithTrade ranks by - for you and the partner.
  gain: number;
  partnerGain: number;
  // The same gains per remaining week.
  gainPpg: number;
  partnerGainPpg: number;
  // Trade value you get minus what you send - the Trade tab's numbers
  // (tradeValues.ts), consolidation credit included - positive = you win
  // the value exchange.
  valueNet: number;
  // 0-100 blend of the lineup gain and valueNet, each percentile-ranked
  // against every trade the search considered - see GRADE_WEIGHTS.
  grade: number;
  // Power-rank positions before and after (1 = best).
  rankBefore: number;
  rankAfter: number;
  partnerRankBefore: number;
  partnerRankAfter: number;
}

// How many suggestions come back, and how many of them any one partner or
// any one of your players can take up - so the list isn't ten variations
// of "trade your RB2 to the same team".
const MAX_SUGGESTIONS = 10;
const MAX_PER_PARTNER = 3;
const MAX_PER_SENT_PLAYER = 3;

// Two-player packages are built from each side's top players by
// rest-of-season points only - pairing two bench afterthoughts never helps
// either side, and the full pair space is what makes the search slow.
const PAIR_POOL_SIZE = 10;

// A trade has to move both teams' rest-of-season totals by at least this
// much (points over the season) to count - below it, the "gain" is noise.
const MIN_GAIN = 1;

// How lopsided a trade's value can be and still be suggested, as your
// share of the trade value changing hands (what you send, consolidation
// credit included - the Trade tab bar's own split). The other manager
// won't take a trade that hands you much more value than they get, so
// you have to send at least MIN_SENT_SHARE - just outside the bar's Fair
// zone (46-54%), a small edge for you at most. MAX_SENT_SHARE keeps out
// trades where you overpay by a lot, even when they'd help your lineup.
const MIN_SENT_SHARE = 0.44;
const MAX_SENT_SHARE = 0.6;

// A trade's grade blends two reads of it, each percentile-ranked against
// every candidate trade first since they're on different scales - the same
// approach infinidraft's report card grades teams with (reportCard.ts's
// percentileRank/GRADE_WEIGHTS): how much it lifts your rest-of-season
// optimal lineup (the PPG read - what it does for your starters), and the
// trade value you get minus what you give (the value read - the Trade
// tab's FantasyCalc-style totals, who wins the exchange starters or not).
// Tunable.
const GRADE_WEIGHTS = {
  lineup: 0.5,
  value: 0.5,
};

// Percentile rank of each value within `all` - share strictly below, plus
// half credit for ties - range (0, 100]; 50 with nothing to compare
// against. Same definition as reportCard.ts's percentileRank, done with a
// sort and binary search since the field here is thousands of trades.
function percentileRanker(all: number[]): (value: number) => number {
  const sorted = [...all].sort((a, b) => a - b);
  const firstIndexAtLeast = (value: number, strict: boolean) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? sorted[mid]! <= value : sorted[mid]! < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return (value) => {
    if (sorted.length <= 1) return 50;
    const below = firstIndexAtLeast(value, false);
    const equal = firstIndexAtLeast(value, true) - below;
    return ((below + equal / 2) / sorted.length) * 100;
  };
}

// Each player's fantasy points per remaining week, in the league's scoring -
// read once up front rather than per lineup evaluation, since the search
// below scores thousands of hypothetical rosters.
function pointsByWeek(inputs: PowerRankingsInputs, fpids: Iterable<number>): Map<number, number[]> {
  const { season, projectionMapsByWeek } = inputs;
  const result = new Map<number, number[]>();
  for (const fpid of fpids) {
    result.set(
      fpid,
      projectionMapsByWeek.map((projectionByFpid) => {
        const projection = projectionByFpid.get(fpid);
        if (!projection) return 0;
        return season.scoring === "PPR"
          ? projection.pointsPpr
          : season.scoring === "HALF"
            ? projection.pointsHalf
            : projection.pointsStd;
      }),
    );
  }
  return result;
}

// One roster's optimal-lineup total over every remaining week - the same
// greedy fill lineupOptimizer.ts's optimizeLineup does (dedicated slots by
// position, then FLEX, then SUPERFLEX), keeping only its optimalPoints, so
// a suggestion's gain matches what getPowerRankingsWithTrade reports when
// the trade is loaded into the analyzer. Stripped down because the search
// below runs it tens of thousands of times.
function makeTeamScorer(inputs: PowerRankingsInputs, weekPoints: Map<number, number[]>) {
  const { rosterSlots, flexPositions, superflexPositions } = inputs.season;
  const slots = expandRosterSlots(rosterSlots);
  const flexCount = slots.filter((slot) => slot.label.startsWith("FLEX")).length;
  const superflexCount = slots.filter((slot) => slot.label.startsWith("SFLEX")).length;
  const weekCount = inputs.projectionMapsByWeek.length;

  return (fpids: number[]): number => {
    const players = fpids.flatMap((fpid) => {
      const position = inputs.positionByFpid.get(fpid);
      const points = weekPoints.get(fpid);
      return position && points ? [{ position, points }] : [];
    });
    let total = 0;
    for (let week = 0; week < weekCount; week++) {
      const sorted = players
        .map((player) => ({ position: player.position, points: player.points[week] ?? 0 }))
        .sort((a, b) => b.points - a.points);
      const used = new Array<boolean>(sorted.length).fill(false);
      for (const position of POSITIONS) {
        let open = rosterSlots[position];
        for (let i = 0; i < sorted.length && open > 0; i++) {
          if (used[i] || sorted[i]!.position !== position) continue;
          used[i] = true;
          total += sorted[i]!.points;
          open--;
        }
      }
      const fill = (count: number, eligible: readonly Position[]) => {
        let open = count;
        for (let i = 0; i < sorted.length && open > 0; i++) {
          if (used[i] || !eligible.includes(sorted[i]!.position)) continue;
          used[i] = true;
          total += sorted[i]!.points;
          open--;
        }
      };
      fill(flexCount, flexPositions);
      fill(superflexCount, superflexPositions);
    }
    return total;
  };
}

// Every package of one or two players from `fpids` - singles from the
// whole roster, pairs from its PAIR_POOL_SIZE best by rest-of-season
// points.
function packages(fpids: number[], weekPoints: Map<number, number[]>): number[][] {
  const seasonPoints = (fpid: number) =>
    (weekPoints.get(fpid) ?? []).reduce((sum, points) => sum + points, 0);
  const useful = fpids.filter((fpid) => seasonPoints(fpid) > 0);
  const pairPool = [...useful]
    .sort((a, b) => seasonPoints(b) - seasonPoints(a))
    .slice(0, PAIR_POOL_SIZE);
  const pairs: number[][] = [];
  for (let i = 0; i < pairPool.length; i++) {
    for (let j = i + 1; j < pairPool.length; j++) pairs.push([pairPool[i]!, pairPool[j]!]);
  }
  return [...useful.map((fpid) => [fpid]), ...pairs];
}

interface Candidate {
  partnerTeamId: Id<"seasonTeams">;
  send: number[];
  receive: number[];
  newTotal: number;
  newPartnerTotal: number;
  gain: number;
  partnerGain: number;
  valueNet: number;
  grade: number;
}

// Trades that would help your team AND the other team, by the same
// rest-of-season optimal-lineup totals the power rankings use: every
// 1-for-1, 2-for-1, and 1-for-2 with every other team in the league (no
// 2-for-2 - the search space balloons and those are rarely the deals
// anyone accepts). Both sides' lineups have to come out ahead and the
// trade value has to be close to even (MIN_SENT_SHARE / MAX_SENT_SHARE) - a
// suggestion the other manager has no reason to accept isn't one worth
// making - and the list is ordered by grade (lineup gain and trade value
// won, blended - see GRADE_WEIGHTS). Taxi and IR players are left
// out on both sides, same as the power rankings' player pool.
export const getTradeSuggestions = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<TradeSuggestion[]> => {
    const inputs = await gatherPowerRankingsInputs(ctx, args.seasonId);
    const { teams, eligibleFpidsByTeam } = inputs;
    const self = teams.find((team) => team.isSelf);
    const selfFpids = self ? eligibleFpidsByTeam.get(self._id) : undefined;
    if (!self || !selfFpids) return [];

    const weekPoints = pointsByWeek(inputs, [...eligibleFpidsByTeam.values()].flat());
    // Each player's trade value - the same numbers the Trade tab adds up.
    // A player missing from them counts as 0.
    const valueByFpid = new Map(
      (await loadTradeValues(ctx, args.seasonId)).map((row) => [row.fpid, row.value]),
    );
    const valuesOf = (fpids: number[]) => fpids.map((fpid) => valueByFpid.get(fpid) ?? 0);
    // What you get minus what you send, consolidation credit included.
    const valueSplit = (send: number[], receive: number[]) => {
      const { totalA: sent, totalB: received } = adjustedTradeTotals(
        valuesOf(send),
        valuesOf(receive),
      );
      return {
        valueNet: received - sent,
        sentShare: sent + received > 0 ? sent / (sent + received) : 0.5,
      };
    };
    const score = makeTeamScorer(inputs, weekPoints);
    const weekCount = inputs.projectionMapsByWeek.length;

    const totalByTeam = new Map<Id<"seasonTeams">, number>();
    for (const [teamId, fpids] of eligibleFpidsByTeam) totalByTeam.set(teamId, score(fpids));
    const selfTotal = totalByTeam.get(self._id) ?? 0;
    const selfPackages = packages(selfFpids, weekPoints);

    const candidates: Candidate[] = [];
    for (const partner of teams) {
      if (partner._id === self._id) continue;
      const partnerFpids = eligibleFpidsByTeam.get(partner._id);
      if (!partnerFpids) continue;
      const partnerTotal = totalByTeam.get(partner._id) ?? 0;
      const partnerPackages = packages(partnerFpids, weekPoints);

      for (const send of selfPackages) {
        for (const receive of partnerPackages) {
          if (send.length + receive.length > 3) continue;
          const sendSet = new Set(send);
          const newSelf = [...selfFpids.filter((fpid) => !sendSet.has(fpid)), ...receive];
          const newTotal = score(newSelf);
          const gain = newTotal - selfTotal;
          // Your side first - most packages don't help you, and that
          // skips scoring the partner's roster for them.
          if (gain < MIN_GAIN) continue;
          const receiveSet = new Set(receive);
          const newPartner = [...partnerFpids.filter((fpid) => !receiveSet.has(fpid)), ...send];
          const newPartnerTotal = score(newPartner);
          const partnerGain = newPartnerTotal - partnerTotal;
          if (partnerGain < MIN_GAIN) continue;
          const { valueNet, sentShare } = valueSplit(send, receive);
          if (sentShare < MIN_SENT_SHARE || sentShare > MAX_SENT_SHARE) continue;
          candidates.push({
            partnerTeamId: partner._id,
            send,
            receive,
            newTotal,
            newPartnerTotal,
            gain,
            partnerGain,
            valueNet,
            grade: 0,
          });
        }
      }
    }

    const lineupPct = percentileRanker(candidates.map((candidate) => candidate.gain));
    const valuePct = percentileRanker(candidates.map((candidate) => candidate.valueNet));
    for (const candidate of candidates) {
      candidate.grade = Math.round(
        GRADE_WEIGHTS.lineup * lineupPct(candidate.gain) +
          GRADE_WEIGHTS.value * valuePct(candidate.valueNet),
      );
    }

    // Best grade first; then the bigger lineup gain; then the simpler
    // (fewer players) deal.
    candidates.sort(
      (a, b) =>
        b.grade - a.grade ||
        b.gain - a.gain ||
        a.send.length + a.receive.length - (b.send.length + b.receive.length),
    );
    const picked: Candidate[] = [];
    const perPartner = new Map<Id<"seasonTeams">, number>();
    const perSent = new Map<number, number>();
    for (const candidate of candidates) {
      if (picked.length >= MAX_SUGGESTIONS) break;
      if ((perPartner.get(candidate.partnerTeamId) ?? 0) >= MAX_PER_PARTNER) continue;
      if (candidate.send.some((fpid) => (perSent.get(fpid) ?? 0) >= MAX_PER_SENT_PLAYER)) continue;
      picked.push(candidate);
      perPartner.set(candidate.partnerTeamId, (perPartner.get(candidate.partnerTeamId) ?? 0) + 1);
      for (const fpid of candidate.send) perSent.set(fpid, (perSent.get(fpid) ?? 0) + 1);
    }

    const players = await ctx.runQuery(api.players.getPlayersByFpids, {
      fpids: [...new Set(picked.flatMap((candidate) => [...candidate.send, ...candidate.receive]))],
    });
    const playerByFpid = new Map(players.map((player) => [player.fpid, player]));
    const toPlayer = (fpid: number): TradeSuggestionPlayer => {
      const player = playerByFpid.get(fpid);
      return {
        fpid,
        name: player?.name ?? "Unknown player",
        position: player?.position ?? inputs.positionByFpid.get(fpid) ?? "QB",
        team: player?.team ?? null,
      };
    };

    // Rank among every team's total, with just the two trading teams'
    // totals swapped for their post-trade ones.
    const rankOf = (teamId: Id<"seasonTeams">, overrides: Map<Id<"seasonTeams">, number>) => {
      const total = overrides.get(teamId) ?? totalByTeam.get(teamId) ?? 0;
      let rank = 1;
      for (const [otherId, otherTotal] of totalByTeam) {
        if (otherId === teamId) continue;
        if ((overrides.get(otherId) ?? otherTotal) > total) rank++;
      }
      return rank;
    };
    const noChange = new Map<Id<"seasonTeams">, number>();
    const perWeek = (points: number) => (weekCount > 0 ? points / weekCount : 0);

    return picked.map((candidate) => {
      const after = new Map([
        [self._id, candidate.newTotal],
        [candidate.partnerTeamId, candidate.newPartnerTotal],
      ]);
      return {
        partnerTeamId: candidate.partnerTeamId,
        partnerName: teams.find((team) => team._id === candidate.partnerTeamId)?.name ?? "Team",
        send: candidate.send.map(toPlayer),
        receive: candidate.receive.map(toPlayer),
        gain: candidate.gain,
        partnerGain: candidate.partnerGain,
        gainPpg: perWeek(candidate.gain),
        partnerGainPpg: perWeek(candidate.partnerGain),
        valueNet: candidate.valueNet,
        grade: candidate.grade,
        rankBefore: rankOf(self._id, noChange),
        rankAfter: rankOf(self._id, after),
        partnerRankBefore: rankOf(candidate.partnerTeamId, noChange),
        partnerRankAfter: rankOf(candidate.partnerTeamId, after),
      };
    });
  },
});
