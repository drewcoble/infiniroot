// Same three-band scheme convex/infinidraft/draft/reportCard.ts's letter
// grades color by (see DraftReportCard.tsx's own gradeColor) - green/gold/
// red, already in @shared/theme, reused directly here since infinileague's
// gradeScore lands on the identical 0-100 scale (see powerRankings.ts's own
// comment on why) even though it's a single-input percentile rather than
// draft grading's 3-way blend.
export function gradeColor(gradeScore: number): string {
  if (gradeScore >= 70) return "green";
  if (gradeScore >= 40) return "gold";
  return "red";
}
