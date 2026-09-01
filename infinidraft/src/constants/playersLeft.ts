// One scale for every bar on the page at any given moment - price
// comparisons only make sense if a $20 player is the same width in every
// position group - but the scale itself is recalculated against whatever's
// still undrafted (see lib/draftRecommendation.ts's barWidth), so it keeps
// making sense as the board thins out over the course of a draft instead of
// staying pinned to early-draft prices.
export const BAR_HEIGHT = 40;
export const MIN_BAR_WIDTH = 50;
export const MAX_BAR_WIDTH = 1500;
// The single most expensive currently-undrafted player's bar reaches this
// width - see barWidth's comment for the full reasoning.
export const TARGET_MAX_BAR_WIDTH = 400;
// Ceiling on the px/dollar rate barWidth derives from TARGET_MAX_BAR_WIDTH
// and the highest remaining value - without this, a depleted board (e.g.
// $1-$5 players left) would need a huge rate to stretch its priciest
// leftover to TARGET_MAX_BAR_WIDTH, ballooning even a $1 player's bar
// toward the same width in the process.
export const MAX_PX_PER_DOLLAR = 20;
export const ICON_SIZE = 16;

// How close (in $) a player's value needs to be to an open budget slot's
// amount to get flagged as a "fits the budget" highlight (see
// isNearAnyOpenSlot in lib/planRecommendation.ts) - a window around the
// number rather than strictly under it, so the highlight stays a small,
// glanceable set of realistic bids instead of "everything cheap enough."
export const BUDGET_MATCH_WINDOW = 2;
