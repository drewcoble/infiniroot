import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { POSITIONS } from "../positions";
import {
  scoringConfigValidator,
  pointsForScoringConfig,
  adpForScoring,
  type ScoringConfig,
} from "../scoring";
import {
  buildValueCurveByPosition,
  estimateMarketValue,
  getRealDraftValues,
  type DraftValueRow,
} from "../draftValues";
import { resolveDraftType } from "../draftType";
import { RELEVANT_ADP_CEILING } from "./tiers";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireDraftOwner } from "./auth";
import {
  optimizeLineup,
  type LineupResult,
  type StarterCategory,
} from "./lineupOptimizer";
import {
  computeConsistencyThresholds,
  getConsistencyLabel,
  type ConsistencyLabel,
} from "./consistency";
import { hasProAccess } from "../billing/entitlements";

type Position = (typeof POSITIONS)[number];

// Loosely mirrors src/lib/keeperCost.ts's valueImpliedRound (convex/ never
// imports from src/ - see convex/draft/tiers.ts's comment on the same
// duplication convention), but with different tie-handling - see below.
// Ranks a player's own projected dollarValue against the pooled (not
// per-position, not ADP) value curve - "this player's actual projected
// production is as good as a typical round-N pick this year." Used for
// grading only (ResolvedPick.roundSurplus/teamValueOf) - the callout
// selectors (calloutValueOf/calloutKeeperValueOf) use real ADP instead and
// only trust this as a same-direction confirmation, see their own comment
// for why relying on either signal alone at the back of the draft is
// wrong.
//
// Ties are averaged (this file's own percentileRank already sets this
// precedent), NOT resolved by keeperCost.ts's plain findIndex - findIndex
// always returns the FIRST (best-ranked) index at or below a given value,
// so every player sharing the exact same floor dollarValue would get
// credited with the single best rank in that entire tied group,
// systematically implying an earlier round than almost all of them
// actually deserve.
//
// That said, callers should never actually invoke this for a VOR<=0 player
// (dollarValue floored at exactly $1 - see draftValues.ts's weight =
// VOR^FALLOFF_EXPONENT, which is exactly 0 there): `values` pools hundreds
// of ranked players per position (Sleeper's rankings go far deeper than any
// real roster - see computeDraftValuesForSettings' own comment), so the
// $1-floor tie group is enormous, often several hundred players wide, not
// merely "dozens." Even averaged, a tie group that size implies a round
// deep into the 20s-30s for a 12-team league - which every real replacement-
// level pick (drafted in the actual, much shallower 12-18 round range)
// would then read as a huge reach purely from the pool being far deeper
// than any draft goes, not from a real skill signal. There genuinely is no
// value-curve signal left once VOR hits 0 - switching the ranking input
// from dollarValue to raw VOR wouldn't help either (dollarValue is a
// strictly monotonic transform of VOR - same order, same ties, same
// oversized floor group) - so computeReportCardData excludes VOR<=0 picks
// from roundSurplus entirely (impliedRound stays null, contributing 0/
// neutral to grading) rather than calling this function for them.
function valueImpliedRound(
  playerValue: number,
  sortedDescending: readonly { dollarValue: number }[],
  teamCount: number,
): number {
  let better = 0;
  let tied = 0;
  for (const v of sortedDescending) {
    if (v.dollarValue > playerValue) better++;
    else if (v.dollarValue === playerValue) tied++;
  }
  const rank = better + (tied + 1) / 2;
  return Math.ceil(rank / teamCount);
}

// Mirrors src/lib/standardValues.ts's buildStandardValueByFpid, trimmed to
// just the overall rank (convex/ never imports from src/ - see convex/draft/
// tiers.ts's comment on the same duplication convention; convex/gemini/
// preDraftInsights.ts keeps its own near-identical copy for the same
// reason). Feeds the blended-ADP display metric below - real market ADP,
// used ONLY for the steals/reaches/best-worst-pick callouts (see
// CALLOUT_POSITIONS and ResolvedPick.adpSurplus), never for grading.
async function buildEspnOverallRankByFpid(
  ctx: QueryCtx,
  season: string,
  scoring: ScoringConfig["scoring"],
  isSuperflex: boolean,
): Promise<Map<number, number>> {
  const loadFormat = async (format: "standard" | "ppr" | "superflex") => {
    const rows = await ctx.db
      .query("standardValues")
      .withIndex("by_platform_format_season_fpid", (q) =>
        q.eq("platform", "espn").eq("format", format).eq("season", season),
      )
      .collect();
    return new Map(rows.map((row) => [row.fpid, row.rank]));
  };

  if (isSuperflex) return loadFormat("superflex");
  if (scoring === "STD") return loadFormat("standard");
  if (scoring === "PPR") return loadFormat("ppr");

  const [std, ppr] = await Promise.all([
    loadFormat("standard"),
    loadFormat("ppr"),
  ]);
  const merged = new Map<number, number>();
  for (const fpid of new Set([...std.keys(), ...ppr.keys()])) {
    const a = std.get(fpid);
    const b = ppr.get(fpid);
    merged.set(
      fpid,
      a !== undefined && b !== undefined ? (a + b) / 2 : (a ?? b)!,
    );
  }
  return merged;
}

interface ResolvedPick {
  pickId: Id<"draftPicks">;
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  teamId: Id<"seasonTeams">;
  price: number;
  sequence: number;
  planSlotKey: string | undefined;
  isKeeper: boolean;
  points: number;
  vor: number;
  // null for keepers - computeDraftValues excludes them from the pool
  // entirely, so there's no market $ estimate for a player never auctioned.
  dollarValue: number | null;
  surplus: number | null;
  // Only populated for keepers (null otherwise) - see estimateMarketValue:
  // an interpolated "what would this production have cost at auction"
  // figure, since keepers have no real dollarValue to compare against.
  // keeperSurplus = keeperEstimatedValue - price (the keeper discount).
  keeperEstimatedValue: number | null;
  keeperSurplus: number | null;
  // Overall draft slot - `overallPick` when the draft tracked round/pick-in-
  // round metadata (snake/linear), else the same as `sequence`. Meaningless
  // for auction (no notion of a "slot"), but set for every pick regardless
  // of format so nothing downstream needs to branch just to read it.
  slot: number;
  // The round this pick actually landed in - `pick.round` when tracked
  // (snake/linear), else derived from `slot`/teamCount. Always set
  // (unlike `pick.round` itself, which is schema-optional) so the round-
  // based math below never needs a null check.
  round: number;
  pickInRound: number | null;
  // Snake/linear's analog of auction's dollarValue: the round this player's
  // OWN projected value (dollarValue, or keeperEstimatedValue for a keeper)
  // implies against the season's full value curve - see valueImpliedRound
  // above. Only ever set for snake/linear; null for auction.
  impliedRound: number | null;
  // Snake/linear's analog of `surplus`/`keeperSurplus`: actual round minus
  // impliedRound - positive means this player's production was worth an
  // earlier (more premium) round than the one they actually cost here (a
  // value), negative means they cost an earlier round than their
  // production justifies (a reach). Needs no separate keeper interpolation
  // step the way auction's `keeperSurplus` does: `keeperEstimatedValue`
  // already exists for exactly this reason (see that field's comment) and
  // feeds valueImpliedRound the same as a real pick's dollarValue.
  roundSurplus: number | null;
  // Real market ADP (Sleeper `adpForScoring` averaged with ESPN's overall
  // draft-kit rank, ESPN alone for superflex) - snake/linear only, and only
  // for CALLOUT_POSITIONS with a real ADP under RELEVANT_ADP_CEILING. Used
  // ONLY for the steals/reaches/best-worst-pick callouts below (never for
  // grading/surplusTotal, which stay on the value-implied-round model per
  // roundSurplus above) - raw ADP is the more intuitive, market-grounded
  // read of "was this actually a steal," even though it's noisier than our
  // own value curve at the back of the draft (see valueImpliedRound's
  // comment on why grading itself avoids it).
  adp: number | null;
  // slot minus adp - positive means this player fell past his market ADP
  // to land here (a value/steal), negative means he went earlier than ADP
  // suggested (a reach). Display/callout metric only - see `adp` above.
  adpSurplus: number | null;
  // Labeled from the *prior* season's actual weekly output
  // (playerSeasonStats), same convention the live draft board already uses
  // (see PlayersLeftTab.tsx) - the current season has no games played yet
  // right after a draft, so there's nothing to label consistency from until
  // several weeks in.
  consistencyLabel: ConsistencyLabel | null;
}

interface RosterAward {
  teamId: Id<"seasonTeams">;
  teamName: string;
  count: number;
}

// Bump whenever computeReportCardData's returned shape OR content changes
// in a way that would make an already-frozen draftReportCardSnapshots row
// (data: v.any()) wrong/unsafe to serve as-is - readReportCardData/
// ensureReportCardSnapshot compare this against each snapshot's own
// `data.version` and transparently recompute+overwrite a mismatch, the
// same way the "Regenerate" button forces a recompute, but automatic.
// Deliberately NOT a "does this snapshot have field X" sniff: that broke
// the first time this shape changed twice in a row (a snapshot frozen with
// `isAuction` but not yet `impliedRound`/`roundSurplus` passed an
// `"isAuction" in data` check and crashed the frontend the same way a
// pre-isAuction snapshot did). Also worth bumping for a pure content/logic
// fix with no shape change (e.g. v3: excluding K/DST from steals/reaches) -
// otherwise an already-completed draft's frozen snapshot would keep serving
// the old, wrong callouts until someone manually clicks Regenerate.
const REPORT_CARD_VERSION = 9;

// Value surplus, VOR, and starters strength are on different scales, so each
// is percentile-ranked against the field before blending - see gradeTeams.
// Surplus is the primary driver for auction (bargain-hunting is the most
// direct reading of "beat the market"); VOR rewards raw talent regardless
// of $; starters strength rewards drafting a roster whose best players (by
// the optimizer's own read of the roster) actually make up the starting
// lineup. Tunable, same convention as draftValues.ts's FALLOFF_EXPONENT.
const AUCTION_GRADE_WEIGHTS = {
  surplus: 0.5,
  vor: 0.3,
  lineup: 0.2,
};
// Snake/linear weights VOR higher and surplus lower than auction - a $
// surplus reading directly means "you got more than you paid," but a
// round-based surplus (see ResolvedPick.roundSurplus) is a noisier signal
// even after the value-curve fix (a late-round bench "reach" still swings
// more than an early-round one), so raw production (VOR) is trusted more
// heavily here. User-requested weighting (2026-08-30) - independently
// tunable from auction's.
const SNAKE_GRADE_WEIGHTS = {
  surplus: 0.25,
  vor: 0.5,
  lineup: 0.25,
};

// Cutoffs are deliberately centered around a percentile-normalized 50 (an
// exactly-average team across all three inputs) landing on a B, not a
// D/F - absolute-grading cutoffs (90+=A, <60=F) would fail most of a small
// league since the inputs are already mean~50 by construction. Adjustable.
const GRADE_BANDS: Array<{ min: number; letter: string }> = [
  { min: 90, letter: "A+" },
  { min: 80, letter: "A" },
  { min: 70, letter: "A-" },
  { min: 60, letter: "B+" },
  { min: 50, letter: "B" },
  { min: 40, letter: "B-" },
  { min: 30, letter: "C+" },
  { min: 20, letter: "C" },
  { min: 10, letter: "D" },
  { min: -Infinity, letter: "F" },
];

// Display order for the Report Card's positional radar chart - QB folds in
// SUPERFLEX (see StarterCategory), FLEX sits with the skill positions it
// pools from rather than at the end.
const CATEGORY_ORDER: StarterCategory[] = [
  "QB",
  "RB",
  "WR",
  "TE",
  "FLEX",
  "DST",
  "K",
];

// Positions the headline steals/reaches/keeper callouts are scoped to - K
// and DST both have such thin, tightly-clustered value that the value curve
// ranks whichever one has even a slight edge as "worth" a much earlier
// round than the rest, while real draft behavior takes them uniformly dead
// last regardless of that edge (a positional-strategy pick, not a value
// one). That systematically reads as a false "steal" for the best kicker
// in the pool - the exact bug this const fixes. Doesn't affect team grades/
// surplus totals elsewhere (see nonKeeperResolved/keeperResolved below),
// only which picks are eligible to headline a callout card.
const CALLOUT_POSITIONS: Position[] = ["QB", "RB", "WR", "TE"];

function letterForScore(score: number): string {
  // The last band's min is -Infinity, so find() always matches something -
  // the ?? "F" fallback only exists to satisfy strict-undefined checking.
  return GRADE_BANDS.find((band) => score >= band.min)?.letter ?? "F";
}

// Standard percentile rank: share of the field strictly below `value`, plus
// half credit for ties (including the value's own row) - range (0, 100].
// With a single team, there's no field to curve against, so default to 50
// (dead center) rather than dividing by zero.
function percentileRank(value: number, all: number[]): number {
  if (all.length <= 1) return 50;
  let below = 0;
  let equal = 0;
  for (const v of all) {
    if (v < value) below++;
    else if (v === value) equal++;
  }
  return ((below + equal / 2) / all.length) * 100;
}

interface TeamRaw {
  teamId: Id<"seasonTeams">;
  teamName: string;
  isSelf: boolean;
  picks: ResolvedPick[];
  spent: number;
  surplusTotal: number;
  surplusByPosition: Record<Position, number>;
  vorTotal: number;
  vorByPosition: Record<Position, number>;
  efficiencyDollarsPerVor: number | null;
  bestPick: ResolvedPick | undefined;
  worstPick: ResolvedPick | undefined;
  bestKeeper: ResolvedPick | undefined;
  worstKeeper: ResolvedPick | undefined;
  lineup: LineupResult;
  // Points from the optimal starting lineup vs. everyone else on the
  // roster - ranked league-wide below into startersRank/benchRank. Framed
  // as a starters-vs-bench comparison rather than "lineup efficiency"
  // because a draft never actually sets a lineup; this is a read on roster
  // construction (top-heavy vs. deep), not in-season lineup decisions.
  startersPoints: number;
  benchPoints: number;
  reliableCount: number;
  boomBustCount: number;
  lowOutputCount: number;
}

// Shared by getDraftReportCardPublic (a public query, gated on the
// drafting league owner's Pro status) and getReportCardDataForSummary (an
// internalQuery, called from the Gemini report-summary action with no
// signed-in caller) - both need the exact same computation, just reached
// via different paths. Takes draft/season as already-loaded docs rather
// than re-fetching, since each caller resolves them differently.
async function computeReportCardData(
  ctx: QueryCtx,
  draft: Doc<"drafts">,
  season: Doc<"seasons">,
  args: { week: string; scoringConfig: ScoringConfig },
) {
  // getRealDraftValues, NOT the public getDraftValues query - the latter
  // decides real-vs-generic off whoever (if anyone) is making the current
  // request, which is wrong here: this runs from contexts with no signed-
  // in caller at all (the scheduled snapshot job) or where the caller
  // viewing a public report card link isn't who Report Card's own Pro gate
  // is checked against (the drafting league's owner). See
  // getRealDraftValues' comment in draftValues.ts for what that bug looked
  // like in practice.
  const values: DraftValueRow[] = await getRealDraftValues(ctx, {
    draftId: draft._id,
    week: args.week,
    scoringConfig: args.scoringConfig,
  });
  const valueByFpid = new Map(values.map((row) => [row.fpid, row]));

  const isAuction = resolveDraftType(season, draft) === "auction";

  // The pool valueImpliedRound ranks each snake/linear pick's own value
  // against - the season's full VBD-computed value curve (every ranked
  // player at every position, independent of who actually got drafted),
  // same "pool" role src/lib/keeperCost.ts's expectedValueAtRound/
  // valueImpliedRound already play for round-mode keeper bargains. Skipped
  // for auction, which has no use for it.
  const sortedByValue = isAuction
    ? []
    : [...values].sort((a, b) => b.dollarValue - a.dollarValue);

  // Team-level "value surplus" grading input: auction's real $ dollarValue
  // surplus, or snake/linear's round-based surplus (see ResolvedPick.
  // roundSurplus) - same role, different unit. Used ONLY for surplusTotal/
  // surplusByPosition/percentile grading below (keepers never contribute to
  // that total, same as auction always excluded them) - best/worst pick and
  // keeper selection use calloutValueOf/calloutKeeperValueOf instead, see
  // their own comment.
  const teamValueOf = (p: ResolvedPick): number | null =>
    isAuction ? p.surplus : p.roundSurplus;

  // Blended market ADP (Sleeper's adpForScoring averaged with ESPN's
  // overall draft-kit rank, ESPN alone for superflex) - the display-only
  // steal/reach signal (see ResolvedPick.adp/adpSurplus), separate from the
  // value-implied-round model teamValueOf/keeperValueOf use for grading.
  // Mirrors convex/gemini/preDraftInsights.ts's snake branch and src/lib/
  // valueRank.ts's buildBlendedAdpByFpid (convex/ can't import src/, so this
  // is its own copy). Skipped entirely for auction, which has no use for it.
  const blendedAdpByFpid = new Map<number, number>();
  if (!isAuction) {
    const isSuperflex = season.rosterSlots.SUPERFLEX > 0;
    const espnRankByFpid = await buildEspnOverallRankByFpid(
      ctx,
      season.year,
      args.scoringConfig.scoring,
      isSuperflex,
    );
    const sleeperAdpByFpid = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const position of CALLOUT_POSITIONS) {
      const rankings = await ctx.db
        .query("rankings")
        .withIndex("by_position_week", (q) =>
          q.eq("position", position).eq("week", args.week),
        )
        .collect();
      for (const ranking of rankings)
        sleeperAdpByFpid.set(ranking.fpid, ranking);
    }
    for (const fpid of new Set([
      ...sleeperAdpByFpid.keys(),
      ...espnRankByFpid.keys(),
    ])) {
      const espnRank = espnRankByFpid.get(fpid);
      // Superflex leagues use ESPN's superflex rank alone - Sleeper's
      // `rankings` table has no superflex-aware ADP field at all, so
      // blending it in would understate QBs relative to a real superflex
      // draft (same precedent buildStandardValueByFpid sets for auction's
      // $-vs-market column).
      if (isSuperflex) {
        if (espnRank !== undefined) blendedAdpByFpid.set(fpid, espnRank);
        continue;
      }
      const adpRow = sleeperAdpByFpid.get(fpid);
      const rawSleeperAdp = adpRow
        ? adpForScoring(adpRow, args.scoringConfig.scoring)
        : undefined;
      const sleeperAdp =
        rawSleeperAdp !== undefined && rawSleeperAdp < RELEVANT_ADP_CEILING
          ? rawSleeperAdp
          : undefined;
      if (sleeperAdp !== undefined && espnRank !== undefined) {
        blendedAdpByFpid.set(fpid, (sleeperAdp + espnRank) / 2);
      } else if (sleeperAdp !== undefined) {
        blendedAdpByFpid.set(fpid, sleeperAdp);
      } else if (espnRank !== undefined) {
        blendedAdpByFpid.set(fpid, espnRank);
      }
    }
  }

  // Steal/reach callout selector (leagueSteals/leagueReaches, each team's
  // bestPick/worstPick) - auction's real $ surplus, or snake/linear's ADP
  // surplus (adpSurplus), gated on agreement with roundSurplus (the
  // grading-only value-curve signal). Neither signal is trustworthy alone
  // at the back of a deep draft: real ADP data barely covers picks that
  // deep (most leagues never draft that far, so it reads almost every deep
  // pick as a reach), while the value curve's own tie-clustering at the
  // replacement floor reads almost every deep pick as a steal (see
  // valueImpliedRound's comment - even after averaging tied ranks there,
  // it's still a noisier read for an individual pick than for an aggregate
  // team total). Requiring both signals to agree on direction before
  // calling something a steal/reach filters out exactly the noise at the
  // tail of the draft where they'd otherwise contradict each other, while
  // still surfacing picks both a market read AND our own projections agree
  // on - the ADP number is what's actually displayed (more intuitive/
  // market-grounded for an individual player), the value curve is purely a
  // sanity-check veto here (2026-08-30, after "all reaches"/"all steals"
  // user reports on each metric alone).
  const calloutValueOf = (p: ResolvedPick): number | null => {
    if (isAuction) return p.surplus;
    if (p.adpSurplus === null || p.roundSurplus === null) return null;
    if (Math.sign(p.adpSurplus) !== Math.sign(p.roundSurplus)) return null;
    return p.adpSurplus;
  };
  // Keeper counterpart - auction keepers have no real `surplus` (only
  // `keeperSurplus`, see that field's comment), so this can't just delegate
  // to calloutValueOf for that branch. ADP needs no such distinction for
  // keepers (it's real market data, available for a kept player exactly
  // like anyone else), so snake/linear reuses the exact same gate/value.
  const calloutKeeperValueOf = (p: ResolvedPick): number | null => {
    if (isAuction) return p.keeperSurplus;
    if (p.adpSurplus === null || p.roundSurplus === null) return null;
    if (Math.sign(p.adpSurplus) !== Math.sign(p.roundSurplus)) return null;
    return p.adpSurplus;
  };

  const replacementByPosition = new Map<Position, number>();
  for (const row of values) {
    if (!replacementByPosition.has(row.position)) {
      replacementByPosition.set(row.position, row.replacementPoints);
    }
  }
  const valueCurveByPosition = buildValueCurveByPosition(values);

  // Consistency labels come from the *prior* completed season's actual
  // weekly results - the season this draft just started has no games
  // played yet, so labeling off it would be empty for everyone.
  const priorSeason = String(Number(season.year) - 1);
  const seasonStats = await ctx.runQuery(api.playerPoints.getAllSeasonStats, {
    season: priorSeason,
    scoringConfig: args.scoringConfig,
  });
  const statsByPosition = new Map<Position, typeof seasonStats>();
  for (const row of seasonStats) {
    const list = statsByPosition.get(row.position) ?? [];
    list.push(row);
    statsByPosition.set(row.position, list);
  }
  const consistencyByFpid = new Map<number, ConsistencyLabel>();
  for (const [position, rows] of statsByPosition) {
    const thresholds = computeConsistencyThresholds(position, rows);
    for (const row of rows) {
      const label = getConsistencyLabel(position, row, thresholds);
      if (label) consistencyByFpid.set(row.fpid, label);
    }
  }

  const teams = await ctx.db
    .query("seasonTeams")
    .withIndex("by_season", (q) => q.eq("seasonId", draft.seasonId))
    .collect();
  const picks = await ctx.db
    .query("draftPicks")
    .withIndex("by_draft_sequence", (q) => q.eq("draftId", draft._id))
    .collect();

  const resolved: ResolvedPick[] = [];
  for (const pick of picks) {
    const slot = pick.overallPick ?? pick.sequence;
    const round = pick.round ?? Math.ceil(slot / season.teamCount);
    const adp =
      !isAuction && CALLOUT_POSITIONS.includes(pick.position)
        ? (blendedAdpByFpid.get(pick.fpid) ?? null)
        : null;
    const adpSurplus = adp !== null ? slot - adp : null;

    const value = valueByFpid.get(pick.fpid);
    if (value) {
      // VOR<=0 (dollarValue floored at $1 - see draftValues.ts's weight =
      // VOR^FALLOFF_EXPONENT, which is exactly 0 there) is excluded rather
      // than ranked - see valueImpliedRound's comment on why a value curve
      // has nothing left to say once a player hits replacement level.
      const impliedRound =
        !isAuction && value.valueOverReplacement > 0
          ? valueImpliedRound(
              value.dollarValue,
              sortedByValue,
              season.teamCount,
            )
          : null;
      const roundSurplus = impliedRound !== null ? round - impliedRound : null;
      resolved.push({
        pickId: pick._id,
        fpid: pick.fpid,
        name: value.name,
        team: value.team,
        position: pick.position,
        teamId: pick.teamId,
        // price is real for auction, meaningless (?? 0) for snake/linear -
        // see teamValueOf/keeperValueOf above for how grading routes around
        // it in that case.
        price: pick.price ?? 0,
        sequence: pick.sequence,
        planSlotKey: pick.planSlotKey,
        isKeeper: pick.isKeeper ?? false,
        points: value.points,
        vor: value.valueOverReplacement,
        dollarValue: value.dollarValue,
        surplus: value.dollarValue - (pick.price ?? 0),
        keeperEstimatedValue: null,
        keeperSurplus: null,
        slot,
        round,
        pickInRound: pick.pickInRound ?? null,
        impliedRound,
        roundSurplus,
        adp,
        adpSurplus,
        consistencyLabel: consistencyByFpid.get(pick.fpid) ?? null,
      });
      continue;
    }

    // Keeper (or, defensively, any pick missing from the value engine's
    // output) - fall back to a direct projections lookup for points/VOR;
    // no market $ estimate exists for a player never auctioned.
    const projection = await ctx.db
      .query("projections")
      .withIndex("by_position_week_fpid", (q) =>
        q
          .eq("position", pick.position)
          .eq("week", args.week)
          .eq("fpid", pick.fpid),
      )
      .unique();
    const points = projection
      ? pointsForScoringConfig(projection, args.scoringConfig)
      : 0;
    const replacementPoints = replacementByPosition.get(pick.position) ?? 0;
    // Unclamped (can go negative for a below-replacement keeper) - matches
    // draftValues.ts's valueOverReplacement, which stopped flooring at 0 for
    // the same reason (see that file's comment). estimateMarketValue already
    // floors its own output at the curve's $1 anchor regardless of a
    // negative input, so this needs no separate clamp before that call.
    const vor = points - replacementPoints;
    const isKeeper = pick.isKeeper ?? false;
    const keeperEstimatedValue = isKeeper
      ? estimateMarketValue(vor, valueCurveByPosition.get(pick.position))
      : null;
    // Same VOR<=0 exclusion as the branch above.
    const impliedRound =
      !isAuction && keeperEstimatedValue !== null && vor > 0
        ? valueImpliedRound(
            keeperEstimatedValue,
            sortedByValue,
            season.teamCount,
          )
        : null;
    const roundSurplus = impliedRound !== null ? round - impliedRound : null;
    resolved.push({
      pickId: pick._id,
      fpid: pick.fpid,
      name: projection?.name ?? `Player ${pick.fpid}`,
      team: projection?.team ?? null,
      position: pick.position,
      teamId: pick.teamId,
      // Same reasoning as the branch above.
      price: pick.price ?? 0,
      sequence: pick.sequence,
      planSlotKey: pick.planSlotKey,
      isKeeper,
      points,
      vor,
      dollarValue: null,
      surplus: null,
      keeperEstimatedValue,
      keeperSurplus:
        keeperEstimatedValue !== null
          ? keeperEstimatedValue - (pick.price ?? 0)
          : null,
      slot,
      round,
      pickInRound: pick.pickInRound ?? null,
      impliedRound,
      roundSurplus,
      adp,
      adpSurplus,
      consistencyLabel: consistencyByFpid.get(pick.fpid) ?? null,
    });
  }

  const rawTeams: TeamRaw[] = teams.map((team) => {
    const teamPicks = resolved.filter((p) => p.teamId === team._id);
    const nonKeeperPicks = teamPicks.filter((p) => !p.isKeeper);

    const spent = teamPicks.reduce((sum, p) => sum + p.price, 0);

    const surplusByPosition = Object.fromEntries(
      POSITIONS.map((pos) => [pos, 0]),
    ) as Record<Position, number>;
    let surplusTotal = 0;
    for (const p of nonKeeperPicks) {
      surplusTotal += teamValueOf(p) ?? 0;
      surplusByPosition[p.position] += teamValueOf(p) ?? 0;
    }

    const vorByPosition = Object.fromEntries(
      POSITIONS.map((pos) => [pos, 0]),
    ) as Record<Position, number>;
    let vorTotal = 0;
    for (const p of teamPicks) {
      vorTotal += p.vor;
      vorByPosition[p.position] += p.vor;
    }

    // K/DST excluded from best/worst pick the same way (and for the same
    // reason) they're excluded from the league-wide steals/reaches/keeper
    // callouts - see CALLOUT_POSITIONS' comment. Doesn't affect
    // surplusTotal/surplusByPosition above, which still grade every
    // position. Selected via calloutValueOf/calloutKeeperValueOf (ADP-based
    // for snake/linear), NOT teamValueOf/keeperValueOf (the value-implied-
    // round model those use for grading) - see calloutValueOf's comment.
    const calloutEligiblePicks = nonKeeperPicks.filter((p) =>
      CALLOUT_POSITIONS.includes(p.position),
    );
    const bestPick = calloutEligiblePicks.reduce<ResolvedPick | undefined>(
      (best, p) =>
        !best || (calloutValueOf(p) ?? 0) > (calloutValueOf(best) ?? 0)
          ? p
          : best,
      undefined,
    );
    const worstPick = calloutEligiblePicks.reduce<ResolvedPick | undefined>(
      (worst, p) =>
        !worst || (calloutValueOf(p) ?? 0) < (calloutValueOf(worst) ?? 0)
          ? p
          : worst,
      undefined,
    );

    const keeperPicks = teamPicks.filter(
      (p) =>
        p.isKeeper &&
        calloutKeeperValueOf(p) !== null &&
        CALLOUT_POSITIONS.includes(p.position),
    );
    const bestKeeper = keeperPicks.reduce<ResolvedPick | undefined>(
      (best, p) =>
        !best ||
        (calloutKeeperValueOf(p) ?? 0) > (calloutKeeperValueOf(best) ?? 0)
          ? p
          : best,
      undefined,
    );
    const worstKeeper = keeperPicks.reduce<ResolvedPick | undefined>(
      (worst, p) =>
        !worst ||
        (calloutKeeperValueOf(p) ?? 0) < (calloutKeeperValueOf(worst) ?? 0)
          ? p
          : worst,
      undefined,
    );

    let reliableCount = 0;
    let boomBustCount = 0;
    let lowOutputCount = 0;
    for (const p of teamPicks) {
      if (p.consistencyLabel === "Reliable") reliableCount++;
      else if (p.consistencyLabel === "Boom/Bust") boomBustCount++;
      else if (p.consistencyLabel === "Low Output") lowOutputCount++;
    }

    const lineup = optimizeLineup(
      teamPicks.map((p) => ({
        fpid: p.fpid,
        position: p.position,
        points: p.points,
        sequence: p.sequence,
        ...(p.planSlotKey !== undefined ? { planSlotKey: p.planSlotKey } : {}),
      })),
      season.rosterSlots,
      season.flexPositions,
      season.superflexPositions,
    );
    const totalPoints = teamPicks.reduce((sum, p) => sum + p.points, 0);

    return {
      teamId: team._id,
      teamName: team.name,
      isSelf: team.isSelf,
      picks: teamPicks,
      spent,
      surplusTotal,
      surplusByPosition,
      vorTotal,
      vorByPosition,
      // $/VOR efficiency has no snake/linear equivalent - every team uses
      // the same number of picks, so there's no "spent" quantity that
      // varies the way auction dollars do.
      efficiencyDollarsPerVor:
        isAuction && vorTotal > 0 ? spent / vorTotal : null,
      bestPick,
      worstPick,
      bestKeeper,
      worstKeeper,
      lineup,
      startersPoints: lineup.optimalPoints,
      benchPoints: totalPoints - lineup.optimalPoints,
      reliableCount,
      boomBustCount,
      lowOutputCount,
    };
  });

  const surplusValues = rawTeams.map((t) => t.surplusTotal);
  const vorValues = rawTeams.map((t) => t.vorTotal);
  const lineupValues = rawTeams.map((t) => t.lineup.efficiencyPct);

  // 1-indexed league rank (1 = best) for starters and bench strength,
  // surfaced in buildTeamSummary/buildSummaryPrompt as "Nth-best
  // starters/bench" instead of the old "points left on the bench" framing.
  const startersRankByTeam = new Map(
    [...rawTeams]
      .sort((a, b) => b.startersPoints - a.startersPoints)
      .map((t, i) => [t.teamId, i + 1]),
  );
  const benchRankByTeam = new Map(
    [...rawTeams]
      .sort((a, b) => b.benchPoints - a.benchPoints)
      .map((t, i) => [t.teamId, i + 1]),
  );

  // Categories the league's roster shape actually uses - a league with no
  // K/DST or no FLEX shouldn't show a flatlined rank-1-for-everyone wedge
  // on the radar chart for a slot nobody starts.
  const activeCategories = CATEGORY_ORDER.filter((category) => {
    if (category === "FLEX") return season.rosterSlots.FLEX > 0;
    if (category === "QB") {
      return season.rosterSlots.QB > 0 || season.rosterSlots.SUPERFLEX > 0;
    }
    return season.rosterSlots[category] > 0;
  });
  const categoryRankByTeam = new Map(
    activeCategories.map((category) => [
      category,
      new Map(
        [...rawTeams]
          .sort(
            (a, b) =>
              b.lineup.optimalPointsByCategory[category] -
              a.lineup.optimalPointsByCategory[category],
          )
          .map((t, i) => [t.teamId, i + 1]),
      ),
    ]),
  );

  const gradeWeights = isAuction ? AUCTION_GRADE_WEIGHTS : SNAKE_GRADE_WEIGHTS;
  const teamReportCards = rawTeams.map((team) => {
    const surplusPct = percentileRank(team.surplusTotal, surplusValues);
    const vorPct = percentileRank(team.vorTotal, vorValues);
    const lineupPct = percentileRank(team.lineup.efficiencyPct, lineupValues);
    const gradeScore = Math.round(
      gradeWeights.surplus * surplusPct +
        gradeWeights.vor * vorPct +
        gradeWeights.lineup * lineupPct,
    );
    return {
      ...team,
      gradeScore,
      letter: letterForScore(gradeScore),
      startersRank: startersRankByTeam.get(team.teamId) ?? 1,
      benchRank: benchRankByTeam.get(team.teamId) ?? 1,
      positionalRanks: activeCategories.map((category) => ({
        category,
        rank: categoryRankByTeam.get(category)?.get(team.teamId) ?? 1,
      })),
    };
  });

  // K/DST excluded here (but not from team grades/surplus totals elsewhere)
  // - see CALLOUT_POSITIONS' comment for why. Nobody actually believes a
  // kicker or streamable defense is a real draft-day steal the way a $30 RB
  // at $15 (or a QB1 falling three rounds past his value) is.
  const nonKeeperResolved = resolved.filter(
    (p) =>
      !p.isKeeper &&
      calloutValueOf(p) !== null &&
      CALLOUT_POSITIONS.includes(p.position),
  );
  const bySurplusDesc = [...nonKeeperResolved].sort(
    (a, b) => (calloutValueOf(b) ?? 0) - (calloutValueOf(a) ?? 0),
  );
  const leagueSteals = bySurplusDesc.slice(0, 5);
  const leagueReaches = bySurplusDesc.slice(-5).reverse();

  const keeperResolved = resolved.filter(
    (p) =>
      p.isKeeper &&
      calloutKeeperValueOf(p) !== null &&
      CALLOUT_POSITIONS.includes(p.position),
  );
  const byKeeperSurplusDesc = [...keeperResolved].sort(
    (a, b) => (calloutKeeperValueOf(b) ?? 0) - (calloutKeeperValueOf(a) ?? 0),
  );
  const leagueBestKeepers = byKeeperSurplusDesc.slice(0, 5);
  const leagueWorstKeepers = byKeeperSurplusDesc.slice(-5).reverse();

  // Only awarded when at least one team actually has a labeled player -
  // an all-zero league (e.g. every roster is rookies/first-year players
  // with no prior-season games) shouldn't crown a "Most Reliable Roster"
  // with a count of 0.
  let mostReliableRoster: RosterAward | null = null;
  let mostVolatileRoster: RosterAward | null = null;
  for (const team of teamReportCards) {
    if (
      team.reliableCount > 0 &&
      (!mostReliableRoster || team.reliableCount > mostReliableRoster.count)
    ) {
      mostReliableRoster = {
        teamId: team.teamId,
        teamName: team.teamName,
        count: team.reliableCount,
      };
    }
    if (
      team.boomBustCount > 0 &&
      (!mostVolatileRoster || team.boomBustCount > mostVolatileRoster.count)
    ) {
      mostVolatileRoster = {
        teamId: team.teamId,
        teamName: team.teamName,
        count: team.boomBustCount,
      };
    }
  }

  return {
    // Bump whenever ResolvedPick/ReportCardData's shape changes - the only
    // thing readReportCardData/ensureReportCardSnapshot trust to tell a
    // fresh snapshot from a stale one now (see REPORT_CARD_VERSION's own
    // comment; a field-presence sniff like "does it have `isAuction`" broke
    // the first time this shape changed twice in a row).
    version: REPORT_CARD_VERSION,
    draftId: draft._id,
    week: args.week,
    scoring: args.scoringConfig.scoring,
    // Threaded through to the frontend/AI recap so neither has to re-derive
    // draft format from the season/draft docs just to decide whether to
    // show $ figures or ADP/slot ones.
    isAuction,
    teams: teamReportCards,
    leagueSteals,
    leagueReaches,
    leagueBestKeepers,
    leagueWorstKeepers,
    mostReliableRoster,
    mostVolatileRoster,
  };
}

type ReportCardData = Awaited<ReturnType<typeof computeReportCardData>>;

// Read-only counterpart of ensureReportCardSnapshot below, for the two
// query contexts (getDraftReportCardPublic, getReportCardDataForSummary)
// that can't write a snapshot themselves. Prefers an already-frozen snapshot;
// falls back to a fresh live computation only when one doesn't exist yet
// (e.g. a draft completed before snapshotting existed, or the scheduled/
// frontend-triggered snapshot call below hasn't landed yet) so the page
// still renders something in the meantime.
async function readReportCardData(
  ctx: QueryCtx,
  draft: Doc<"drafts">,
  season: Doc<"seasons">,
  args: { week: string; scoringConfig: ScoringConfig },
): Promise<ReportCardData> {
  const snapshot = await ctx.db
    .query("draftReportCardSnapshots")
    .withIndex("by_draft_week_scoring", (q) =>
      q
        .eq("draftId", draft._id)
        .eq("week", args.week)
        .eq("scoring", args.scoringConfig.scoring),
    )
    .unique();
  // A snapshot frozen under an older REPORT_CARD_VERSION has an
  // incompatible shape (missing fields entirely - undefined, not null),
  // not just stale numbers. Falls through to a fresh live computation the
  // same way "no snapshot yet" does, rather than serving an old-shape
  // payload the frontend/Gemini prompt builder will crash reading e.g.
  // `.toFixed()` off of.
  if (
    snapshot &&
    (snapshot.data as { version?: number }).version === REPORT_CARD_VERSION
  ) {
    return snapshot.data as ReportCardData;
  }
  return await computeReportCardData(ctx, draft, season, args);
}

// Freezes computeReportCardData's output the first time it's called for a
// given (draftId, week, scoring), so the Report Card - and any AI recap
// generated from it - reads the same numbers forever after, rather than
// drifting as convex/crons.ts's daily projection refetch updates the
// dollarValue/points everything else here is derived from. Idempotent: a
// second call just returns the already-stored snapshot untouched.
//
// Doesn't check Pro access - freezing is a data-correctness concern, not a
// monetization one, so a free-tier league still gets a snapshot ready to
// show the moment its owner upgrades. (Doesn't check draft.kind === "real"
// either for the same reason a mock draft's owner could still want to look
// at one, though in practice only syncDraftStatus's real-draft-only
// scheduling and the Pro-gated UI ever trigger this.)
//
// Not auto-invalidated by a post-completion pick correction - a
// commissioner fixing a pick after the draft is already "complete" leaves
// any existing snapshot (and AI text built from it) stale until the
// Report Card's "Regenerate" button (regenerateReportSummary) is clicked,
// which clears this row too and lets it recompute.
async function ensureReportCardSnapshot(
  ctx: MutationCtx,
  args: { draftId: Id<"drafts">; week: string; scoringConfig: ScoringConfig },
): Promise<ReportCardData | null> {
  const draft = await ctx.db.get(args.draftId);
  if (!draft || draft.status !== "complete") return null;
  const season = await ctx.db.get(draft.seasonId);
  if (!season) return null;

  const existing = await ctx.db
    .query("draftReportCardSnapshots")
    .withIndex("by_draft_week_scoring", (q) =>
      q
        .eq("draftId", args.draftId)
        .eq("week", args.week)
        .eq("scoring", args.scoringConfig.scoring),
    )
    .unique();
  // Same stale-shape check as readReportCardData above - a snapshot from an
  // older REPORT_CARD_VERSION gets recomputed and overwritten in place (not
  // a second row) rather than served as-is.
  if (
    existing &&
    (existing.data as { version?: number }).version === REPORT_CARD_VERSION
  ) {
    return existing.data as ReportCardData;
  }

  const data = await computeReportCardData(ctx, draft, season, args);
  if (existing) {
    await ctx.db.patch(existing._id, { data, generatedAt: Date.now() });
  } else {
    await ctx.db.insert("draftReportCardSnapshots", {
      draftId: args.draftId,
      week: args.week,
      scoring: args.scoringConfig.scoring,
      data,
      generatedAt: Date.now(),
    });
  }
  return data;
}

// Scheduled once by convex/draft/status.ts's syncDraftStatus, right when a
// real draft first transitions into status "complete" - primes the
// snapshot immediately so it's ready before anyone even opens the Report
// Card page.
export const snapshotReportCard = internalMutation({
  args: {
    draftId: v.id("drafts"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: ensureReportCardSnapshot,
});

// Frontend-triggered backfill (see DraftReportCard.tsx), same convention as
// ensureReportSummaryGenerated below - covers a draft that completed before
// this snapshotting existed, or the rare case where the scheduled
// snapshotReportCard above hasn't run yet by the time the owner opens the
// page.
export const ensureReportCardSnapshotted = mutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    if (draft.status !== "complete") return;
    await ensureReportCardSnapshot(ctx, {
      draftId: draft._id,
      week: args.week,
      scoringConfig: args.scoringConfig,
    });
  },
});

// Public, no-signed-in-required counterpart of the old owner-only
// getDraftReportCard - the Report Card is now a shareable link
// (src/routes/reportCard/$leagueId.tsx), same convention as the TV board's
// *Public queries (see convex/leagues.ts's getSeasonPublic, convex/draft/
// teams.ts's listSeasonTeamsPublic): no ownership check, the unguessable
// seasonId in the URL is what limits who can find it.
//
// Still gated on Pro access, but on the drafting league's OWNER's status
// (league.ownerId), not the viewer's - there may be no signed-in viewer at
// all, and Report Card generation is something the league owner pays for,
// not something every individual visitor would separately subscribe to.
// This mirrors how the AI recap (convex/gemini/reportSummary.ts) already
// gates off league.ownerId rather than the caller.
export const getDraftReportCardPublic = query({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return { status: "not_ready" as const };
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_season_kind", (q) =>
        q.eq("seasonId", args.seasonId).eq("kind", "real"),
      )
      .first();
    if (!draft || draft.status !== "complete") {
      return { status: "not_ready" as const };
    }

    const league = await ctx.db.get(season.leagueId);
    if (!league || !(await hasProAccess(ctx, league.ownerId))) {
      return { status: "requires_upgrade" as const };
    }

    const data = await readReportCardData(ctx, draft, season, args);

    // AI-written recap (+ per-team blurbs), generated once by convex/gemini/
    // reportSummary.ts's generateReportSummary action when the draft first
    // completes - see convex/draft/status.ts. Only the generated text is
    // cached (not this query's inputs), so null here just means "not
    // generated yet" (or the action failed/skipped, e.g. GEMINI_API_KEY
    // unset) - the frontend falls back to the free templated recap
    // (src/lib/reportCardSummary.ts) whenever a summary is null, per team
    // as well as league-wide (teamSummaries is also absent entirely on rows
    // cached before per-team summaries existed).
    const cachedSummary = await ctx.db
      .query("draftReportSummaries")
      .withIndex("by_draft_week_scoring", (q) =>
        q
          .eq("draftId", draft._id)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .unique();
    const aiTeamSummaryByTeamId = new Map(
      (cachedSummary?.teamSummaries ?? []).map((t) => [t.teamId, t.summary]),
    );

    // Purely a UI hint for the frontend (show the Regenerate button? fire
    // the auto-backfill mutations?) - NOT a security boundary. Even if a
    // client spoofed this to true, ensureReportCardSnapshotted/
    // ensureReportSummaryGenerated/regenerateReportSummary each still run
    // their own requireDraftOwner check server-side, so a non-owner's
    // mutation call would just fail regardless of what this said.
    const userId = await getAuthUserId(ctx);
    const isOwner = userId !== null && userId === league.ownerId;

    return {
      status: "ok" as const,
      isOwner,
      data: {
        ...data,
        aiSummary: cachedSummary?.summary ?? null,
        teams: data.teams.map((team) => ({
          ...team,
          aiSummary: aiTeamSummaryByTeamId.get(team.teamId) ?? null,
        })),
      },
    };
  },
});

// Internal counterpart of getDraftReportCardPublic, for convex/gemini/
// reportSummary.ts's generateReportSummary action - a scheduled background
// job with no signed-in caller. Re-derives the same status/kind/Pro-access
// checks directly off draftId instead, returning null (rather than
// throwing) whenever any of them fail - the action just skips generating a
// summary in that case, since there's no user waiting on a response to
// show an error to.
export const getReportCardDataForSummary = internalQuery({
  args: {
    draftId: v.id("drafts"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.status !== "complete" || draft.kind !== "real") {
      return null;
    }
    const season = await ctx.db.get(draft.seasonId);
    if (!season) return null;
    const league = await ctx.db.get(season.leagueId);
    if (!league || !(await hasProAccess(ctx, league.ownerId))) return null;

    return await readReportCardData(ctx, draft, season, args);
  },
});

// Backfill trigger for the AI recap - convex/draft/status.ts only ever
// schedules generateReportSummary once, at the moment a draft first
// completes, checking Pro access at that exact instant. A free-tier owner
// who upgrades later would otherwise never get an AI recap for a draft
// that already finished while they were free (the numeric report card
// itself doesn't have this problem, since getDraftReportCardPublic
// re-checks Pro access live on every read). The Report Card page calls this once on
// load whenever it sees status "ok" with a null aiSummary - idempotent
// (checks for an existing cached row, and generateReportSummary itself
// re-checks Pro access + a cache row before spending a Gemini call), so
// it's safe to call on every such page view, not just the first.
export const ensureReportSummaryGenerated = mutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    if (draft.status !== "complete" || draft.kind !== "real") return;

    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasProAccess(ctx, userId))) return;

    const existing = await ctx.db
      .query("draftReportSummaries")
      .withIndex("by_draft_week_scoring", (q) =>
        q
          .eq("draftId", draft._id)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .unique();
    if (existing) return;

    await ctx.scheduler.runAfter(
      0,
      internal.gemini.reportSummary.generateReportSummary,
      {
        draftId: draft._id,
        week: args.week,
        scoringConfig: args.scoringConfig,
      },
    );
  },
});

// Manual "Regenerate" action on the Report Card page - unlike
// ensureReportSummaryGenerated (which only fills in a *missing* recap),
// this clears whatever's cached first, so it also covers a bad recap (e.g.
// one that came back truncated - see convex/gemini/client.ts's
// finishReason check, added after exactly that happened live) or one gone
// stale after a commissioner corrected a pick post-completion.
//
// Also clears the frozen draftReportCardSnapshots row (not just the AI
// text) and lets generateReportSummary recompute it fresh - otherwise this
// button would refresh the prose but leave every number on the page locked
// to whatever was true the first time the draft completed, which defeats
// the point of a "regenerate everything" action. This is the only way an
// existing snapshot ever gets recomputed post-completion (see that table's
// schema comment on the commissioner-correction gap).
export const regenerateReportSummary = mutation({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
  },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    if (draft.status !== "complete" || draft.kind !== "real") {
      throw new Error("Draft isn't complete yet.");
    }

    const userId = await getAuthUserId(ctx);
    if (!userId || !(await hasProAccess(ctx, userId))) {
      throw new Error("Report Card is a Pro feature.");
    }

    const existingSummaries = await ctx.db
      .query("draftReportSummaries")
      .withIndex("by_draft_week_scoring", (q) =>
        q
          .eq("draftId", draft._id)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .collect();
    for (const row of existingSummaries) await ctx.db.delete(row._id);

    const existingSnapshot = await ctx.db
      .query("draftReportCardSnapshots")
      .withIndex("by_draft_week_scoring", (q) =>
        q
          .eq("draftId", draft._id)
          .eq("week", args.week)
          .eq("scoring", args.scoringConfig.scoring),
      )
      .unique();
    if (existingSnapshot) await ctx.db.delete(existingSnapshot._id);

    await ctx.scheduler.runAfter(
      0,
      internal.gemini.reportSummary.generateReportSummary,
      {
        draftId: draft._id,
        week: args.week,
        scoringConfig: args.scoringConfig,
      },
    );
  },
});
