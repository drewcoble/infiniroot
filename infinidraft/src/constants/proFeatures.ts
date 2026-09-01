// What Pro actually unlocks, kept in one place so BillingPage and
// UpgradePrompt show the same list rather than two copies drifting apart -
// mirrors what's gated server-side (see STRIPE.md's "Built" section):
// convex/leagues.ts's createLeague (league cap) and setUseKeepers
// (keepers), convex/draft/reportCard.ts (Report Card, and by extension the
// AI recap it triggers - see convex/gemini/reportSummary.ts),
// convex/draft/insights.ts (pre-draft AI Insights - see convex/gemini/
// preDraftInsights.ts), and convex/draftValues.ts (real vs. generic $
// values). Lineup Optimizer deliberately left off this list - it's gated
// alongside the Report Card, but not confident enough in its output yet to
// advertise it as a selling point.
export const PRO_FEATURES: string[] = [
  "Unlimited leagues - the free plan is capped at 5 new leagues per year",
  "Real $ player values tuned to your league's actual settings, instead of a generic 12-team/$200 estimate",
  "In-depth keeper support - custom formulas/tiers, per-team keeper limits, and consecutive-year tracking",
  "Draft Report Card - grades, value surplus, VOR, and starters & bench rankings for every team, plus an AI-written recap",
  "AI Draft Insights - an AI-written pre-draft briefing on where your league's $ values diverge from the market and how your keepers should shape draft-day strategy",
];
