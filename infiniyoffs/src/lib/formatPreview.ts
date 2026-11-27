import { roundName, seedSlotOrder } from "@playoffRules/evaluate";
import type { PlayoffFormat, Stage, TeamSource } from "@playoffRules/format";

// A format as a seeds-only sketch for the settings preview: each stage's
// weeks as columns of games ("1 vs 8", "2 · bye"), no teams or scores.

export interface PreviewGame {
  // Null is a bye.
  sides: [string, string | null];
}

export interface PreviewColumn {
  weeks: number[];
  name: string;
  games: PreviewGame[];
  note?: string;
}

export interface PreviewStage {
  id: string;
  name: string;
  columns: PreviewColumn[];
  // One line under the stage, e.g. what "G1" means.
  caption?: string;
}

// How many teams a source brings, and their labels in stage-seed order.
function sourceLabels(
  source: TeamSource,
  format: PlayoffFormat,
  teamCount: number,
  sizes: Map<string, number>,
): { labels: string[]; legend?: string } {
  const numbered = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => (count === 1 ? prefix : `${prefix}${i + 1}`));
  switch (source.from) {
    case "seeds":
      return {
        labels: Array.from(
          { length: source.lastSeed - source.firstSeed + 1 },
          (_, i) => `${source.firstSeed + i}`,
        ),
      };
    case "pointsLeaders":
    case "wildcards":
      return { labels: numbered("WC", source.count), legend: "WC = points wildcard" };
    case "advancers": {
      const from = format.stages.find((s) => s.id === source.stageId);
      const count =
        from?.kind === "groups"
          ? from.groupCount * from.advancePerGroup
          : from?.kind === "points"
            ? from.advance
            : 1;
      return { labels: numbered("G", count), legend: "G = group winner, by seed" };
    }
    case "eliminated":
      return { labels: numbered("E", Math.max(0, (sizes.get(source.stageId) ?? 1) - 1)) };
    case "nonEntrants": {
      const inStage = sizes.get(source.stageId) ?? 0;
      return {
        labels: Array.from({ length: teamCount - inStage }, (_, i) => `${inStage + i + 1}`),
      };
    }
  }
}

function bracketColumns(
  stage: Extract<Stage, { kind: "bracket" }>,
  labels: string[],
): PreviewColumn[] {
  const roundCount = stage.roundWeeks.length;
  // A slot is a team label, a game's winner ("4/5", or "TBD" past that),
  // or a bye (null).
  let slots: (string | null)[] = seedSlotOrder(2 ** roundCount).map(
    (seed) => labels[seed - 1] ?? null,
  );
  const columns: PreviewColumn[] = [];
  for (let round = 1; round <= roundCount; round++) {
    const reseeded = stage.reseed && round > 1;
    const games: PreviewGame[] = [];
    const next: (string | null)[] = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i] ?? null;
      const b = slots[i + 1] ?? null;
      if (a === null || b === null) {
        const team = a ?? b;
        if (team !== null && round === 1) games.push({ sides: [team, null] });
        next.push(team);
        continue;
      }
      games.push({ sides: reseeded ? ["TBD", "TBD"] : [a, b] });
      const simple = !a.includes("/") && a !== "TBD" && !b.includes("/") && b !== "TBD";
      next.push(simple && !reseeded ? `${a}/${b}` : "TBD");
    }
    columns.push({
      weeks: stage.roundWeeks[round - 1] ?? [],
      name: roundName(round, roundCount),
      games,
      ...(reseeded && round === 2 ? { note: "Reseeded" } : {}),
    });
    slots = next;
  }
  return columns;
}

function doubleElimColumns(
  stage: Extract<Stage, { kind: "doubleElim" }>,
  labels: string[],
): PreviewColumn[] {
  const columns: PreviewColumn[] = [];
  let unbeaten = labels.length;
  let onceBeaten = 0;
  stage.weeks.forEach((week, i) => {
    const games: PreviewGame[] = [];
    let note: string | undefined;
    if (i === 0) {
      // Best seed vs worst; the best sits out in an odd field.
      const field = [...labels];
      if (field.length % 2 === 1) games.push({ sides: [field.shift()!, null] });
      while (field.length >= 2) games.push({ sides: [field.shift()!, field.pop()!] });
    } else {
      const sides = [
        [Math.floor(unbeaten / 2), "unbeaten"],
        [Math.floor(onceBeaten / 2), "once-beaten"],
      ] as const;
      note = sides
        .filter(([games]) => games > 0)
        .map(([games, side]) => `${games} ${side}`)
        .join(" · ");
    }
    const drops = Math.floor(unbeaten / 2);
    unbeaten = Math.ceil(unbeaten / 2);
    onceBeaten = Math.ceil(onceBeaten / 2) + drops;
    columns.push({ weeks: [week], name: `Round ${i + 1}`, games, ...(note ? { note } : {}) });
  });
  columns.push({
    weeks: [stage.rumbleWeek],
    name: "Royal Rumble",
    games: [],
    note: `${unbeaten + onceBeaten} left, top score wins`,
  });
  columns.push({
    weeks: [stage.finalWeek],
    name: "Final",
    games: [{ sides: ["Rumble", "Unbeaten"] }],
    note: "If needed",
  });
  return columns;
}

function groupColumns(
  stage: Extract<Stage, { kind: "groups" }>,
  format: PlayoffFormat,
): { columns: PreviewColumn[]; caption: string } {
  const formation = stage.formation;
  const letters = Array.from({ length: stage.groupCount }, (_, g) => String.fromCharCode(65 + g));
  if (formation.kind === "serpentine") {
    return {
      columns: stage.weeks.map((week) => ({
        weeks: [week],
        name: "Groups",
        games: [],
        note: "Round robin",
      })),
      caption: `${stage.groupCount} groups dealt out by seed`,
    };
  }
  const tier = format.tiers.find((t) => t.name === formation.drafterTier);
  const heads = letters.map((_, g) => `${(tier?.firstSeed ?? 1) + g}`);
  const column = (week: number, name: string, rival: string): PreviewColumn => ({
    weeks: [week],
    name,
    games: heads.map((head) => ({ sides: [head, rival] })),
  });
  return {
    columns: [
      ...formation.draftWeeks.map((week) => column(week, "Drafted", "pick")),
      ...formation.rematchWeeks.map((week) => column(week, "Rematch", "pick")),
    ],
    caption: `${formation.drafterTier} teams draft their group's opponents and weeks`,
  };
}

export function previewFormat(format: PlayoffFormat, teamCount: number): PreviewStage[] {
  const sizes = new Map<string, number>();
  return format.stages.map((stage) => {
    const sources = stage.entrants.map((source) =>
      sourceLabels(source, format, teamCount, sizes),
    );
    const labels = sources.flatMap((source) => source.labels);
    sizes.set(stage.id, labels.length);
    const legends = [...new Set(sources.flatMap((source) => source.legend ?? []))];
    const legend = legends.length ? legends.join(" · ") : undefined;
    switch (stage.kind) {
      case "bracket":
        return {
          id: stage.id,
          name: stage.name,
          columns: bracketColumns(stage, labels),
          ...(legend ? { caption: legend } : {}),
        };
      case "doubleElim":
        return { id: stage.id, name: stage.name, columns: doubleElimColumns(stage, labels) };
      case "groups": {
        const { columns, caption } = groupColumns(stage, format);
        return { id: stage.id, name: stage.name, columns, caption };
      }
      case "points":
        return {
          id: stage.id,
          name: stage.name,
          columns: [
            {
              weeks: stage.weeks,
              name: "Points race",
              games: [],
              note: `Top ${stage.advance} of ${labels.length} advance`,
            },
          ],
        };
    }
  });
}
