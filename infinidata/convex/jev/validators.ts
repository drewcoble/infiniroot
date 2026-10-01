import { v } from "convex/values";

const jevScoreValidator = v.object({
  score: v.number(),
  label: v.string(),
  confidence: v.number(),
});

// Jev's read of one injury (see convex/infinileague/injuryAssessment.ts).
export const injuryAssessmentValidator = v.object({
  assessedAt: v.number(),
  model: v.string(),
  // Set when a hard rule (e.g. IR) overrode the model's plays-next-game
  // answer, naming the rule.
  ruleOverride: v.optional(v.string()),
  availability: v.optional(jevScoreValidator),
  limitation: v.optional(jevScoreValidator),
  timeline: v.optional(
    v.object({
      choice: v.string(),
      probability: v.number(),
      confidence: v.number(),
    }),
  ),
  aggravationRisk: v.optional(v.number()),
});
