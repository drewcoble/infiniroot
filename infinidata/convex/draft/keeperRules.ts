import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { positionValidator } from "../positions";
import { requireDraftNotStarted } from "./auth";

const keeperFormulaValidator = v.object({
  multiplier: v.number(),
  flatAdd: v.number(),
  minimumCost: v.optional(v.number()),
});

// Kept in sync with schema.ts's keeperRoundFormulaValidator by hand - this
// file predates that schema addition and validates its own args shape
// rather than importing the schema's (mutation args validators in this
// codebase are conventionally self-contained, not schema-derived).
const keeperRoundFormulaValidator = v.object({
  roundsEarlier: v.number(),
  minimumRound: v.optional(v.number()),
  undraftedRound: v.optional(v.number()),
});

const keeperTierValidator = v.object({
  id: v.string(),
  name: v.string(),
  maxSize: v.optional(v.number()),
  formula: keeperFormulaValidator,
  roundFormula: v.optional(keeperRoundFormulaValidator),
  fpids: v.array(v.number()),
  positions: v.optional(v.array(positionValidator)),
});

const keeperRulesValidator = v.object({
  costMode: v.optional(v.union(v.literal("dollar"), v.literal("round"))),
  defaultFormula: v.object({
    multiplier: v.number(),
    flatAdd: v.number(),
    minimumCost: v.optional(v.number()),
    undraftedCost: v.optional(v.number()),
  }),
  defaultRoundFormula: v.optional(keeperRoundFormulaValidator),
  tiers: v.array(keeperTierValidator),
  maxKeepersPerTeam: v.optional(v.number()),
  maxConsecutiveYears: v.optional(v.number()),
  roundConflictResolution: v.optional(
    v.union(v.literal("earlier"), v.literal("later")),
  ),
});

// Full replace of the season's keeper cost/eligibility config - called by
// the League Details "Keeper Rules" panel's Save button. Doesn't validate
// that any tier is currently under its own maxSize (an admin might
// legitimately lower maxSize below a tier's current membership while
// editing formulas, and setKeeperTierPlayers below is what enforces the cap
// going forward) - it just persists whatever shape the panel built.
export const setKeeperRules = mutation({
  args: {
    seasonId: v.id("seasons"),
    keeperRules: keeperRulesValidator,
  },
  handler: async (ctx, args) => {
    await requireDraftNotStarted(ctx, args.seasonId);
    await ctx.db.patch(args.seasonId, {
      keeperRules: {
        ...args.keeperRules,
        // Derived, not client-set - see schema.ts's trackConsecutiveYears
        // comment. Computed here (not trusted from the client) so it's
        // always in sync with maxConsecutiveYears regardless of what any
        // particular client build sends.
        trackConsecutiveYears:
          args.keeperRules.maxConsecutiveYears !== undefined,
      },
    });
    return null;
  },
});

// Patches one tier's designated-player list without touching the rest of
// keeperRules (formulas, the other tiers, the two max settings) - used by
// the per-tier player picker so toggling one player in/out doesn't require
// resending the whole config. Enforces the tier's own maxSize and that no
// fpid ends up in more than one tier at once (a player's formula is
// resolved by "first tier containing this fpid," so an accidental overlap
// would silently pick whichever tier happens to be listed first).
export const setKeeperTierPlayers = mutation({
  args: {
    seasonId: v.id("seasons"),
    tierId: v.string(),
    fpids: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const { season } = await requireDraftNotStarted(ctx, args.seasonId);
    const keeperRules = season.keeperRules;
    if (!keeperRules) {
      throw new Error("No keeper rules configured for this league.");
    }
    const tier = keeperRules.tiers.find((t) => t.id === args.tierId);
    if (!tier) {
      throw new Error("Keeper tier not found.");
    }
    if (tier.maxSize !== undefined && args.fpids.length > tier.maxSize) {
      throw new Error(`"${tier.name}" allows at most ${tier.maxSize} players.`);
    }
    const newFpidSet = new Set(args.fpids);
    const overlap = keeperRules.tiers.some(
      (other) =>
        other.id !== args.tierId &&
        other.fpids.some((fpid) => newFpidSet.has(fpid)),
    );
    if (overlap) {
      throw new Error(
        "A player can only be designated in one keeper tier at a time.",
      );
    }

    const tiers = keeperRules.tiers.map((t) =>
      t.id === args.tierId ? { ...t, fpids: args.fpids } : t,
    );
    await ctx.db.patch(args.seasonId, {
      keeperRules: { ...keeperRules, tiers },
    });
    return null;
  },
});
