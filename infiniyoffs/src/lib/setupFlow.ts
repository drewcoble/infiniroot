import type { PlayoffFormat, PresetConfig } from "@playoffRules/format";
import { presetFormat } from "@playoffRules/presets";
import { defaultConfig, savedKind, type Kind } from "./rulesConfig";
import type { SeasonData } from "./seasonData";

// The setup flow's steps and the choices made so far - kept as a draft on
// the server (convex/infiniyoffs/setup.ts) until Review saves them.

export type StepId = "type" | "schedule" | "teams" | "bonus" | "review" | "invite";

export const STEP_LABELS: Record<StepId, string> = {
  type: "Playoff type",
  schedule: "Schedule",
  teams: "Teams & seeding",
  bonus: "Bonuses",
  review: "Review",
  invite: "Invite",
};

export interface SetupDraft {
  step: StepId;
  kind: Kind;
  // The preset's settings - null for the platform's playoffs or custom.
  config: PresetConfig | null;
}

// Each type's steps: following the platform or keeping custom rules goes
// straight to Review; double elimination has no bonuses.
export function stepsFor(kind: Kind): StepId[] {
  switch (kind) {
    case "platform":
    case "custom":
      return ["type", "review", "invite"];
    case "doubleElim":
      return ["type", "schedule", "teams", "review", "invite"];
    case "standard":
    case "worldCup":
      return ["type", "schedule", "teams", "bonus", "review", "invite"];
  }
}

// Where a fresh setup starts: the saved rules if there are any (a re-run
// from Settings), else the platform's.
export function initialDraft(saved: PlayoffFormat | null): SetupDraft {
  return { step: "type", kind: savedKind(saved), config: saved?.preset ?? null };
}

// A draft read back from the server, if it still makes sense.
export function parseDraft(value: unknown): SetupDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<SetupDraft>;
  const kinds: Kind[] = ["platform", "standard", "doubleElim", "worldCup", "custom"];
  if (!draft.kind || !kinds.includes(draft.kind)) return null;
  if (!draft.step || !stepsFor(draft.kind).includes(draft.step)) return null;
  const presetKind = draft.kind === "platform" || draft.kind === "custom" ? null : draft.kind;
  const config = draft.config ?? null;
  if (presetKind !== null && config?.kind !== presetKind) return null;
  return { step: draft.step, kind: draft.kind, config: presetKind ? config : null };
}

// Picking a type: the saved settings if it's the saved type, else that
// type's defaults.
export function withKind(
  draft: SetupDraft,
  kind: Kind,
  data: SeasonData,
  saved: PlayoffFormat | null,
): SetupDraft {
  if (kind === draft.kind) return draft;
  if (kind === "platform" || kind === "custom") return { ...draft, kind, config: null };
  const config = saved?.preset?.kind === kind ? saved.preset : defaultConfig(kind, data, saved);
  return { ...draft, kind, config };
}

// The rules the draft would save.
export function draftFormat(
  draft: SetupDraft,
  teamCount: number,
  saved: PlayoffFormat | null,
): PlayoffFormat | null {
  if (draft.kind === "platform") return null;
  if (draft.kind === "custom" || !draft.config) return saved;
  return presetFormat(draft.config, teamCount);
}
