import { v } from "convex/values";
import { action, ActionCtx, internalMutation, internalQuery } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { sleeperPlayerIdToFpid } from "../../sleeper/league";

export interface TradeValueRow {
  fpid: number;
  // What the Trade tab adds up: the average of the two below, or just the
  // projection value for a player FantasyCalc doesn't price (K/DST).
  value: number;
  // FantasyCalc's redraft value for the league's settings - null for K/DST,
  // which FantasyCalc doesn't value at all. A skill player missing from its
  // list is priced at 0 (it only lists players it considers worth
  // anything).
  marketValue: number | null;
  // Our rest-of-season VOR, put on FantasyCalc's scale by rank: the
  // player with our Nth-best rosVor gets FantasyCalc's Nth-highest value,
  // so the two halves of `value` are directly comparable.
  projectionValue: number;
}

// How long a cached FantasyCalc pull is reused before refetching.
const CACHE_MS = 12 * 60 * 60 * 1000;

// FantasyCalc doesn't value these.
const UNPRICED_POSITIONS = new Set(["K", "DST"]);

interface FantasyCalcRow {
  player: { sleeperId: string | null };
  value: number;
}

export const getCachedValues = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    await ctx.db
      .query("fantasyCalcValues")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first(),
});

export const saveCachedValues = internalMutation({
  args: {
    key: v.string(),
    values: v.array(v.object({ fpid: v.number(), value: v.number() })),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fantasyCalcValues")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    const fetchedAt = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { values: args.values, fetchedAt });
    } else {
      await ctx.db.insert("fantasyCalcValues", { key: args.key, values: args.values, fetchedAt });
    }
  },
});

// FantasyCalc's values for these league settings - from the cache when
// fresh, otherwise fetched and cached. A failed fetch falls back to a stale
// cache when there is one, and to no market values at all (projection-only)
// when there isn't, rather than breaking the Trade tab.
async function marketValues(
  ctx: ActionCtx,
  settings: { teams: number; qbs: number; ppr: number },
): Promise<Map<number, number> | null> {
  const key = `${settings.teams}:${settings.qbs}:${settings.ppr}`;
  const cached = await ctx.runQuery(internal.infinileague.season.tradeValues.getCachedValues, {
    key,
  });
  const toMap = (values: { fpid: number; value: number }[]) =>
    new Map(values.map((row) => [row.fpid, row.value]));
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return toMap(cached.values);

  try {
    const url =
      `https://api.fantasycalc.com/values/current?isDynasty=false` +
      `&numQbs=${settings.qbs}&numTeams=${settings.teams}&ppr=${settings.ppr}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`FantasyCalc responded ${response.status}`);
    const rows = (await response.json()) as FantasyCalcRow[];
    const values = rows.flatMap((row) => {
      const fpid = row.player.sleeperId ? sleeperPlayerIdToFpid(row.player.sleeperId) : null;
      return fpid !== null ? [{ fpid, value: row.value }] : [];
    });
    await ctx.runMutation(internal.infinileague.season.tradeValues.saveCachedValues, {
      key,
      values,
    });
    return toMap(values);
  } catch (err) {
    console.warn("FantasyCalc fetch failed", err);
    return cached ? toMap(cached.values) : null;
  }
}

// Every player on the league's rosVOR board with a FantasyCalc-style trade
// value (thousands scale, additive) - see TradeValueRow. Blends the market
// (FantasyCalc, matched to the league's team count, 1QB/superflex, and PPR
// setting) with our own rest-of-season projection, half each. Shared by
// getTradeValues (the Trade tab's numbers) and tradeSuggestions.ts's
// grading, so a suggestion's value read matches what loading it shows.
export async function loadTradeValues(
  ctx: ActionCtx,
  seasonId: Id<"seasons">,
): Promise<TradeValueRow[]> {
  const { season } = await ctx.runQuery(internal.rosterSync.requireOwnedSeasonForSync, {
    seasonId,
  });
  const teams = await ctx.runQuery(internal.seasonTeams.listSeasonTeamsInternal, {
    seasonId,
  });
  const nflState = await ctx.runQuery(api.nflState.getNflState, {});
  const week = nflState ? String(Math.max(Number(nflState.week), 1)) : "1";
  const board = await ctx.runQuery(api.rosVor.getRosVorBoard, {
    seasonId,
    week,
  });

  const market = await marketValues(ctx, {
    teams: teams.length,
    qbs: season.rosterSlots.SUPERFLEX > 0 ? 2 : 1,
    ppr: season.scoring === "PPR" ? 1 : season.scoring === "HALF" ? 0.5 : 0,
  });

  // Rank-match our board onto the market's value curve. Without market
  // data there's no curve to borrow - fall back to a plain rescale of
  // rosVor (best player = 10,000).
  const marketCurve = market ? [...market.values()].sort((a, b) => b - a) : null;
  const byVor = [...board].sort((a, b) => b.rosVor - a.rosVor);
  const topVor = Math.max(byVor[0]?.rosVor ?? 0, 1);
  const projectionByFpid = new Map(
    byVor.map((row, index) => [
      row.fpid,
      Math.round(
        marketCurve ? (marketCurve[index] ?? 0) : Math.max(row.rosVor, 0) * (10000 / topVor),
      ),
    ]),
  );

  return board.map((row) => {
    const projectionValue = projectionByFpid.get(row.fpid) ?? 0;
    const marketValue =
      market === null || UNPRICED_POSITIONS.has(row.position) ? null : (market.get(row.fpid) ?? 0);
    return {
      fpid: row.fpid,
      value:
        marketValue === null ? projectionValue : Math.round((marketValue + projectionValue) / 2),
      marketValue,
      projectionValue,
    };
  });
}

export const getTradeValues = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<TradeValueRow[]> =>
    await loadTradeValues(ctx, args.seasonId),
});

// Each side's sent trade values added up, plus a consolidation credit so
// two decent players don't automatically out-total one star. The credit
// goes to the side sending the single most valuable player in the trade,
// and only when that side sends fewer players: the other side's extra
// pieces (its lowest-valued ones, as many as it sends beyond the star
// side's count) count only (1 - EXTRA_PIECE_DISCOUNT) as much. Mirrored in
// infinileague/src/lib/tradeValue.ts, which the Trade tab's header uses -
// keep the two in step.
const EXTRA_PIECE_DISCOUNT = 0.5;

function consolidationCredit(starSide: number[], otherSide: number[]): number {
  const extra = otherSide.length - starSide.length;
  if (extra <= 0) return 0;
  const lowest = [...otherSide].sort((a, b) => a - b).slice(0, extra);
  return Math.round(lowest.reduce((sum, value) => sum + value, 0) * EXTRA_PIECE_DISCOUNT);
}

// Side A's and side B's sent totals, consolidation credit included.
export function adjustedTradeTotals(
  valuesA: number[],
  valuesB: number[],
): { totalA: number; totalB: number } {
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const topA = Math.max(0, ...valuesA);
  const topB = Math.max(0, ...valuesB);
  return {
    totalA: sum(valuesA) + (topA > topB ? consolidationCredit(valuesA, valuesB) : 0),
    totalB: sum(valuesB) + (topB > topA ? consolidationCredit(valuesB, valuesA) : 0),
  };
}
