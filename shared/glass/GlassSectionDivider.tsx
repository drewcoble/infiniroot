import classes from "./GlassMatchupCard.module.css";

// Labeled break between list sections (a roster's Bench / IR / Taxi, a
// standings list's tiers) - a hairline either side of a small caps label,
// with extra space above so the groups read as separate.
export function GlassSectionDivider({ label }: { label: string }) {
  return (
    <div className={classes.sectionDivider} role="separator" aria-label={label}>
      <span className={classes.sectionLine} />
      <span className={classes.sectionLabel}>{label}</span>
      <span className={classes.sectionLine} />
    </div>
  );
}
