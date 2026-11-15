import type { SeasonInput } from "@playoffRules/evaluate";
import { EMPTY_DRAFT, type DraftState, type PlayoffFormat } from "@playoffRules/format";
import type { PlayoffRules, SeasonData } from "./seasonData";

// The recorded matchup draft, if the format has one (one per league).
export function draftState(format: PlayoffFormat, rules: PlayoffRules | undefined): DraftState {
  const stage = format.stages.find(
    (s) => s.kind === "groups" && s.formation.kind === "matchupDraft",
  );
  const row = stage && rules?.drafts.find((draft) => draft.stageId === stage.id);
  if (!row) return EMPTY_DRAFT;
  return {
    slots: row.slots,
    picks: row.picks.map(({ drafterId, opponentId, week }) => ({ drafterId, opponentId, week })),
    rematches: row.rematches.map(({ drafterId, opponentId, week }) => ({
      drafterId,
      opponentId,
      week,
    })),
  };
}

// Where things stand: final weeks count, this week's live points show.
export function currentInput(
  data: SeasonData,
  format: PlayoffFormat,
  rules: PlayoffRules | undefined,
): SeasonInput {
  return {
    teamIds: data.teams.map((team) => team.teamId),
    schedule: data.schedule,
    medianGame: data.medianGame,
    points: data.points,
    finalThroughWeek: data.finalThroughWeek,
    draft: draftState(format, rules),
  };
}

export function lastFormatWeek(format: PlayoffFormat): number {
  const weeks = format.stages.flatMap((stage) =>
    stage.kind === "bracket" ? stage.roundWeeks.flat() : stage.weeks,
  );
  return Math.max(format.regularSeasonEndWeek, ...weeks);
}
