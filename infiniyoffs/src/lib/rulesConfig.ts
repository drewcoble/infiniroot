import { keepsDraft, keepsManualGroups } from "@playoffRules/carryOver";
import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import {
  defaultDoubleElim,
  defaultStandard,
  defaultWorldCup,
  presetFormat,
} from "@playoffRules/presets";
import type { PlayoffRules, SeasonData } from "./seasonData";

// The settings page's playoff types: what each saves as, and what a save
// would throw away.

export type Kind = "platform" | PresetConfig["kind"] | "custom";

export const LAST_WEEK = 18;

export function savedKind(saved: PlayoffFormat | null): Kind {
  return saved === null ? "platform" : (saved.preset?.kind ?? "custom");
}

// A fresh config for a newly picked type, keeping the saved playoff start
// and team count where the type has them.
export function defaultConfig(
  kind: PresetConfig["kind"],
  data: SeasonData,
  saved: PlayoffFormat | null,
): PresetConfig {
  const platform = data.platformPlayoffs;
  const end =
    saved?.regularSeasonEndWeek ??
    platform?.regularSeasonEndWeek ??
    data.platformRegularSeasonEndWeek;
  const teams =
    saved?.preset && "playoffTeams" in saved.preset
      ? saved.preset.playoffTeams
      : platform?.playoffTeamCount || Math.min(6, data.teams.length);
  switch (kind) {
    case "standard":
      return defaultStandard(end, teams);
    case "doubleElim": {
      // Bracket weeks, then the Rumble and the final, by week 18.
      const config = defaultDoubleElim(end, data.teams.length);
      return { ...config, bracketWeeks: Math.max(1, Math.min(4, LAST_WEEK - end - 2)) };
    }
    case "worldCup":
      return { ...defaultWorldCup(), regularSeasonEndWeek: end };
  }
}

// What saving `next` would throw away, e.g. "the hand-set groups" - null
// for nothing.
export function resetsBySaving(
  rules: PlayoffRules,
  next: PlayoffFormat | null,
): string | null {
  const saved = (rules.format ?? null) as PlayoffFormat | null;
  const lost = [
    rules.drafts.some((draft) => !keepsDraft(saved, next, draft.stageId)) && "the matchup draft",
    rules.manualGroups.some((row) => !keepsManualGroups(saved, next, row.stageId)) &&
      "the hand-set groups",
  ].filter(Boolean);
  return lost.length ? lost.join(" and ") : null;
}

// The format a picked type saves as: the saved one if it's the saved type,
// else that type's defaults.
export function typeFormat(
  kind: Kind,
  data: SeasonData,
  saved: PlayoffFormat | null,
): PlayoffFormat | null {
  if (kind === "platform") return null;
  if (kind === "custom") return saved;
  if (saved?.preset?.kind === kind) return saved;
  return presetFormat(defaultConfig(kind, data, saved), data.teams.length);
}
