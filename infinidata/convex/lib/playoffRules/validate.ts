import type { PlayoffFormat, TeamSource } from "./format";

// Structural checks on a commissioner-submitted PlayoffFormat - the
// playoffSettings row stores it as v.any(), so this is its schema. Returns
// the first problem found, or null.
export function formatProblem(format: PlayoffFormat, teamCount: number): string | null {
  const isWeek = (week: number) => Number.isInteger(week) && week >= 1 && week <= 18;
  if (!isWeek(format.regularSeasonEndWeek)) return "The regular season must end in weeks 1-18.";
  for (const tier of format.tiers) {
    if (!tier.name) return "Every tier needs a name.";
    if (tier.firstSeed < 1 || tier.lastSeed > teamCount || tier.firstSeed > tier.lastSeed) {
      return `Tier ${tier.name}'s seeds must fall within 1-${teamCount}.`;
    }
  }
  const seen = new Set<string>();
  for (const stage of format.stages) {
    if (!stage.id || seen.has(stage.id)) return "Every stage needs its own id.";
    const sources: TeamSource[] = stage.entrants;
    for (const source of sources) {
      if (source.from === "seeds" || source.from === "pointsLeaders") {
        const { firstSeed, lastSeed } = source;
        if (firstSeed < 1 || lastSeed > teamCount || firstSeed > lastSeed) {
          return `${stage.name}: seeds must fall within 1-${teamCount}.`;
        }
      } else {
        const ids = source.from === "wildcards" ? source.stageIds : [source.stageId];
        if (ids.some((id) => !seen.has(id))) {
          return `${stage.name} draws from a stage that doesn't come before it.`;
        }
      }
    }
    seen.add(stage.id);
    const weeks = stage.kind === "bracket" ? stage.roundWeeks.flat() : stage.weeks;
    if (weeks.length === 0 || !weeks.every(isWeek)) return `${stage.name}: weeks must be 1-18.`;
    if (weeks.some((week) => week <= format.regularSeasonEndWeek)) {
      return `${stage.name} can't start before the regular season ends.`;
    }
    if (stage.kind === "groups" && stage.formation.kind === "matchupDraft") {
      const formation = stage.formation;
      if (!format.tiers.some((tier) => tier.name === formation.drafterTier)) {
        return `${stage.name}: the drafting tier doesn't exist.`;
      }
      if (formation.draftWeeks.length !== 3) {
        return `${stage.name}: a matchup draft needs groups of four (three draft weeks).`;
      }
    }
  }
  if (!seen.has(format.championshipStageId)) return "Pick which stage crowns the champion.";
  return null;
}
