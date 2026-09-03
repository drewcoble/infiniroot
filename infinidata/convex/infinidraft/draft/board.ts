import { v } from "convex/values";
import { query } from "../../_generated/server";
import { api } from "../../_generated/api";
import { positionValidator, POSITIONS } from "../../positions";
import { scoringConfigValidator } from "../../scoring";
import { requireDraftOwner } from "../../lib/access";
import { computeTiers } from "./tiers";

type Position = (typeof POSITIONS)[number];

// Matches draftValues.getDraftValues' return shape - annotated explicitly
// (rather than inferred through ctx.runQuery) to avoid a TS7022 circular-type
// error: this file's own export feeds back into the `api` object that
// draftValues.getDraftValues's reference is read from.
interface DraftValueRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  points: number;
  positionRank: number;
  replacementPoints: number;
  usedFallback: boolean;
  valueOverReplacement: number;
  dollarValue: number;
}

// Wraps draftValues.getDraftValues (the existing VBD $ engine) with tiers -
// deliberately NOT joined with draftPicks here. This query's only read
// dependencies are the season + projections (+ getDraftValues' own
// narrowly-scoped keeper read, see below), all stable for the duration of a
// live draft, so it doesn't get invalidated/recomputed on every single pick
// the way a picks-joined version would. Live "is this player drafted" status
// is joined client-side instead (see PlayersLeftTab, which already has a
// listDraftPicks subscription for other reasons) - that join is cheap and
// re-running it on every pick is fine; re-running this VBD computation on
// every pick was the expensive part.
//
// The one intentional exception: getDraftValues itself reads keepers (via
// draftPicks' by_draft_keeper index, scoped to isKeeper===true) to exclude
// them from the pool and adjust $ values. Don't "fix" that into a general
// draftPicks join - it would reintroduce the exact per-pick recompute this
// file avoids. Keepers are set once during setup and don't change during
// the live draft, which is what makes reading them here safe.
export const getDraftBoard = query({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    scoringConfig: scoringConfigValidator,
    position: v.optional(positionValidator),
  },
  handler: async (ctx, args) => {
    await requireDraftOwner(ctx, args.seasonId);

    const valuesResult: { isGeneric: boolean; values: DraftValueRow[] } =
      await ctx.runQuery(api.draftValues.getDraftValues, {
        seasonId: args.seasonId,
        week: args.week,
        scoringConfig: args.scoringConfig,
        ...(args.position ? { position: args.position } : {}),
      });
    const { isGeneric, values } = valuesResult;

    // ADP doesn't change during a live draft (same reasoning as the keepers
    // read documented above), so joining it here doesn't reintroduce the
    // per-pick recompute this query otherwise avoids. Positions are read off
    // `values` itself (rather than re-deriving activePositions from the
    // season) since that's already exactly the set of positions this call
    // needs.
    const positions = Array.from(new Set(values.map((row) => row.position)));
    const adpByFpid = new Map<
      number,
      { adpStd: number; adpHalf: number; adpPpr: number }
    >();
    for (const position of positions) {
      const rankings = await ctx.db
        .query("rankings")
        .withIndex("by_position_week", (q) =>
          q.eq("position", position).eq("week", args.week),
        )
        .collect();
      for (const ranking of rankings) {
        adpByFpid.set(ranking.fpid, ranking);
      }
    }

    const tiersByFpid = computeTiers(values, adpByFpid, args.scoringConfig.scoring);
    const withTiers = values.map((row) => ({
      ...row,
      ...tiersByFpid.get(row.fpid)!,
    }));

    // Reorder to the blended tierRank (not the incoming points order) per
    // position, so rows arrive in contiguous tier order for consumers that
    // group by tier - see PlayersLeftTab.tsx's groupByTier.
    const byPosition = new Map<Position, typeof withTiers>();
    for (const row of withTiers) {
      const list = byPosition.get(row.position) ?? [];
      list.push(row);
      byPosition.set(row.position, list);
    }
    for (const list of byPosition.values()) {
      list.sort((a, b) => a.tierRank - b.tierRank);
    }

    return {
      isGeneric,
      rows: positions.flatMap((position) => byPosition.get(position) ?? []),
    };
  },
});
