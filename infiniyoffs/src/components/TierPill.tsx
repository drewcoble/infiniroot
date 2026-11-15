import type { PlayoffFormat } from "@playoffRules/format";
import { pillStyle } from "@shared/glass/pills";
import classes from "@shared/glass/GlassMatchupCard.module.css";

// Tier pill colors, top tier first.
const TIER_COLORS = ["yellow", "teal", "blue", "gray", "grape", "orange"];

export function TierPill({ format, tier }: { format: PlayoffFormat; tier: string }) {
  const index = format.tiers.findIndex((t) => t.name === tier);
  return (
    <span className={classes.pill} style={pillStyle(TIER_COLORS[index] ?? "gray")}>
      {tier}
    </span>
  );
}
