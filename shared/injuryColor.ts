// Extracted from infinidraft's src/lib/playerFormatting.ts (which also has
// formatStatKey, staying app-specific there) so both apps can import this
// one function without either owning the other's file.
export function injuryColor(status: string): string {
  const s = status.toUpperCase();
  if (s.includes("IR") || s.includes("OUT")) return "red";
  if (s.includes("DOUBTFUL")) return "orange";
  if (s.includes("QUESTIONABLE")) return "yellow";
  return "gray";
}
