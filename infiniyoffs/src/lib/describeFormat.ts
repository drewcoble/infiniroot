import type { PlayoffFormat, Stage, TeamSource, Tiebreaker } from "@playoffRules/format";
import { stageWeeks } from "./bracketView";

// A format in plain lines for the Rules page - one per part: regular
// season, tiers, then each stage.

function weekRange(weeks: number[]): string {
  const sorted = [...weeks].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? `week ${first}` : `weeks ${first}-${last}`;
}

function seedRange(first: number, last: number): string {
  return first === last ? `seed ${first}` : `seeds ${first}-${last}`;
}

function tiebreakerText(rule: Tiebreaker): string {
  switch (rule.kind) {
    case "winPct":
      return "record";
    case "pointsFor":
      return `points (weeks ${rule.fromWeek}-${rule.toWeek})`;
    case "pointsAgainst":
      return "fewest points against";
    case "headToHead":
      return "head-to-head";
    case "seed":
      return "seed";
  }
}

function sourceText(source: TeamSource, names: Map<string, string>): string {
  const stage = (id: string) => names.get(id) ?? id;
  switch (source.from) {
    case "seeds":
      return seedRange(source.firstSeed, source.lastSeed);
    case "advancers":
      return `${stage(source.stageId)} winners`;
    case "eliminated":
      return `everyone out of the ${stage(source.stageId)}`;
    case "nonEntrants":
      return `everyone outside the ${stage(source.stageId)}`;
    case "pointsLeaders":
    case "wildcards": {
      const noun = source.count === 1 ? "wildcard" : "wildcards";
      return `${source.count} points ${noun} (weeks ${source.fromWeek}-${source.toWeek})`;
    }
  }
}

function stageText(stage: Stage, format: PlayoffFormat, names: Map<string, string>): string {
  const when = weekRange(stageWeeks(stage));
  const from = stage.entrants.map((source) => sourceText(source, names)).join(" + ");
  const tierBonus = Object.entries(stage.bonus?.byTier ?? {});
  const bonus = tierBonus.length
    ? ` Weekly bonus ${format.tiers
        .map((tier) => `${tier.name} +${stage.bonus?.byTier?.[tier.name] ?? 0}`)
        .join(" · ")}.`
    : "";
  switch (stage.kind) {
    case "groups": {
      const formation = stage.formation;
      let formed = "groups dealt out by seed";
      if (formation.kind === "matchupDraft") {
        formed = `${formation.drafterTier} teams draft their groups`;
        formed += ` (${weekRange(formation.draftWeeks)})`;
        if (formation.rematchWeeks.length) {
          formed += `, then pick a ${weekRange(formation.rematchWeeks)} rematch`;
        }
      }
      const advance =
        stage.advancePerGroup === 1
          ? "Group winners advance"
          : `Top ${stage.advancePerGroup} advance`;
      return (
        `${stage.name} (${when}): ${from} in ${stage.groupCount} groups; ${formed}.` +
        `${bonus} ${advance}.`
      );
    }
    case "bracket": {
      const seeded = stage.reseed ? " Reseeded each round." : "";
      const multiWeek = stage.roundWeeks.some((weeks) => weeks.length > 1)
        ? " Rounds are two weeks."
        : "";
      const bowl = stage.loserAdvances ? " Losers advance." : "";
      const seedBonus = Object.entries(stage.bonus?.bySeedRound ?? {})
        .map(([seed, perRound]) => `#${seed} ${perRound.map((b) => `+${b}`).join("/")}`)
        .join(", ");
      const bonusText = seedBonus ? ` Seed bonus by round: ${seedBonus}.` : "";
      return `${stage.name} (${when}): ${from}.${seeded}${multiWeek}${bowl}${bonusText}${bonus}`;
    }
    case "points":
      return `${stage.name} (${when}): ${from}; top ${stage.advance} in points advance.${bonus}`;
    case "doubleElim":
      return (
        `${stage.name} (${weekRange(stage.weeks)}): ${from}. Two losses and you're out; ` +
        "each week, best seed plays worst. " +
        `Royal Rumble week ${stage.rumbleWeek}: everyone left plays, top score wins - ` +
        "the last unbeaten team is champion if it's them, otherwise the Rumble winner " +
        `plays them in week ${stage.finalWeek}.${bonus}`
      );
  }
}

export function describeFormat(format: PlayoffFormat): string[] {
  const names = new Map(format.stages.map((stage) => [stage.id, stage.name]));
  const lines = [
    `Regular season: weeks 1-${format.regularSeasonEndWeek}, seeded by ` +
      `${format.seeding.map(tiebreakerText).join(", then ")}.`,
  ];
  if (format.tiers.length) {
    lines.push(
      "Tiers: " +
        format.tiers.map((t) => `${t.name} ${seedRange(t.firstSeed, t.lastSeed)}`).join(" · ") +
        ".",
    );
  }
  for (const stage of format.stages) lines.push(stageText(stage, format, names));
  return lines;
}
