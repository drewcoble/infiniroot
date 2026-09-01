import { v } from "convex/values";

export const POSITIONS = ["QB", "RB", "WR", "TE", "DST", "K"] as const;

export const positionValidator = v.union(
  v.literal("QB"),
  v.literal("RB"),
  v.literal("WR"),
  v.literal("TE"),
  v.literal("DST"),
  v.literal("K"),
);

// Positions convex/projectionBlending.ts averages across every provider's
// raw stats (see convex/scoring.ts's computeProjectedPoints and
// providerProjections' schema comment). K/DST are excluded - their scoring
// isn't reproduced by computeProjectedPoints yet - and still get their
// points written straight from Sleeper, the way every position used to (see
// convex/sleeper/projections.ts).
export const BLENDED_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type BlendedPosition = (typeof BLENDED_POSITIONS)[number];
