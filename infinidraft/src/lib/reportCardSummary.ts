import type { FunctionReturnType } from "convex/server";
import { api } from "@infinidata/api";
import { formatSignedNumber } from "./keeperValue";

type ReportCardResult = FunctionReturnType<
  typeof api.infinidraft.draft.reportCard.getDraftReportCardPublic
>;
// The "ok" branch's payload - the only branch with real data to summarize.
// "not_ready"/"requires_upgrade" are handled by DraftReportCard.tsx before
// either summary builder below is ever called.
export type ReportCard = Extract<ReportCardResult, { status: "ok" }>["data"];
export type TeamCard = ReportCard["teams"][number];
export type PickRow = TeamCard["picks"][number];
export type RosterAward = NonNullable<ReportCard["mostReliableRoster"]>;

function formatSigned(amount: number): string {
  return amount >= 0 ? `+$${amount.toFixed(0)}` : `-$${Math.abs(amount).toFixed(0)}`;
}

// Snake/linear's team-total "beat the market" threshold is in rounds, not
// dollars - a fractional-round gap is noise (every pick has some), so this
// needs to be a real, whole-round swing to be worth a sentence. Gates
// team.surplusTotal (the value-implied-round model) - see ADP_SURPLUS_
// THRESHOLD below for the separate, ADP-based per-pick threshold.
const ROUND_SURPLUS_THRESHOLD = 1;

// Per-pick ADP surplus threshold (draft-slot spots, not rounds) - gates
// individual pick mentions (bestPick/worstPick/bestKeeper/leagueSteals/
// leagueReaches), which use real market ADP rather than the value-implied-
// round model (see PickRow.adpSurplus's comment in convex/draft/
// reportCard.ts for why the two are deliberately different metrics).
const ADP_SURPLUS_THRESHOLD = 3;

function gradeDescriptor(letter: string): string {
  if (letter.startsWith("A")) return "elite drafting";
  if (letter.startsWith("B")) return "a solid, well-balanced effort";
  if (letter.startsWith("C")) return "a middle-of-the-pack showing";
  return "a rough night - plenty to learn from before next year";
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// "best" at rank 1, "worst" at the bottom of the league, "Nth best"
// otherwise - used to describe a team's starters/bench rank in prose, e.g.
// "the 6th best starters & the best bench".
export function rankDescriptor(rank: number, totalTeams: number): string {
  if (rank === 1) return "best";
  if (rank === totalTeams) return "worst";
  return `${ordinal(rank)} best`;
}

// Templated (not AI-generated) recap, built entirely from fields
// getDraftReportCardPublic already computes - free and instant, unlike the AI
// option discussed for a future iteration. Reads like a few sentences of
// prose rather than a stat block, but every number in it traces back to a
// field already rendered elsewhere on the card.
export function buildTeamSummary(
  team: TeamCard,
  totalTeams: number,
  isAuction: boolean,
): string {
  const sentences: string[] = [
    `${team.teamName} earns a ${team.letter} - ${gradeDescriptor(team.letter)}.`,
  ];

  if (isAuction) {
    if (team.surplusTotal >= 1 && team.bestPick) {
      sentences.push(
        `They beat the market by ${formatSigned(team.surplusTotal)} across the draft, headlined by ${team.bestPick.name} at $${team.bestPick.price} (${formatSigned(team.bestPick.surplus ?? 0)} value).`,
      );
    } else if (team.surplusTotal <= -1 && team.worstPick) {
      sentences.push(
        `They paid a premium overall (${formatSigned(team.surplusTotal)}), most notably reaching on ${team.worstPick.name} for $${team.worstPick.price} (${formatSigned(team.worstPick.surplus ?? 0)}).`,
      );
    }
  } else {
    if (team.surplusTotal >= ROUND_SURPLUS_THRESHOLD && team.bestPick) {
      sentences.push(
        `They beat their draft slots by ${formatSignedNumber(team.surplusTotal)} rounds across the board, headlined by landing ${team.bestPick.name} at pick #${team.bestPick.slot} (${formatSignedNumber(team.bestPick.adpSurplus ?? 0)} vs his ADP).`,
      );
    } else if (team.surplusTotal <= -ROUND_SURPLUS_THRESHOLD && team.worstPick) {
      sentences.push(
        `They drafted ahead of their players' actual value overall (${formatSignedNumber(team.surplusTotal)} rounds), most notably reaching on ${team.worstPick.name} at pick #${team.worstPick.slot} (${formatSignedNumber(team.worstPick.adpSurplus ?? 0)} vs his ADP).`,
      );
    }
  }

  if (totalTeams > 1) {
    sentences.push(
      `They have the ${rankDescriptor(team.startersRank, totalTeams)} starters & the ${rankDescriptor(team.benchRank, totalTeams)} bench in the league.`,
    );
  }

  if (isAuction) {
    if (team.bestKeeper && (team.bestKeeper.keeperSurplus ?? 0) >= 5) {
      sentences.push(
        `Their sharpest move was keeping ${team.bestKeeper.name} for $${team.bestKeeper.price} - a bargain worth ${formatSigned(team.bestKeeper.keeperSurplus ?? 0)}.`,
      );
    }
  } else if (
    team.bestKeeper &&
    (team.bestKeeper.adpSurplus ?? 0) >= ADP_SURPLUS_THRESHOLD
  ) {
    sentences.push(
      `Their sharpest move was keeping ${team.bestKeeper.name} at pick #${team.bestKeeper.slot} - a bargain worth ${formatSignedNumber(team.bestKeeper.adpSurplus ?? 0)} vs his ADP.`,
    );
  }

  const notableConsistencyCount = Math.max(
    team.reliableCount,
    team.boomBustCount,
  );
  if (notableConsistencyCount >= 3) {
    if (team.reliableCount >= team.boomBustCount) {
      sentences.push(
        `Behind the scenes, ${team.reliableCount} of their players were Reliable performers last season.`,
      );
    } else {
      sentences.push(
        `They're leaning on ${team.boomBustCount} boom/bust players from last season - highest ceiling, highest risk.`,
      );
    }
  }

  return sentences.join(" ");
}

// League-wide recap paragraph for the top of the report card page - same
// "templated, not AI" approach as buildTeamSummary above.
export function buildLeagueSummary(report: ReportCard): string {
  const sentences: string[] = [];
  const teamNameById = new Map(report.teams.map((t) => [t.teamId, t.teamName]));

  const champion = [...report.teams].sort(
    (a, b) => b.gradeScore - a.gradeScore,
  )[0];
  if (champion) {
    sentences.push(
      `${champion.teamName} takes the top grade of the draft with a ${champion.letter}.`,
    );
  }

  const steal = report.leagueSteals[0];
  const stealValue = report.isAuction ? steal?.surplus : steal?.adpSurplus;
  if (steal && report.isAuction && (stealValue ?? 0) >= 1) {
    const stealTeam = teamNameById.get(steal.teamId) ?? "One team";
    sentences.push(
      `The steal of the draft: ${stealTeam} landed ${steal.name} for just $${steal.price}, ${formatSigned(stealValue ?? 0)} under market value.`,
    );
  } else if (steal && !report.isAuction && (stealValue ?? 0) >= ADP_SURPLUS_THRESHOLD) {
    const stealTeam = teamNameById.get(steal.teamId) ?? "One team";
    sentences.push(
      `The steal of the draft: ${stealTeam} landed ${steal.name} at pick #${steal.slot}, ${formatSignedNumber(stealValue ?? 0)} spots after his ADP.`,
    );
  }

  const reach = report.leagueReaches[0];
  const reachValue = report.isAuction ? reach?.surplus : reach?.adpSurplus;
  if (reach && report.isAuction && (reachValue ?? 0) <= -1) {
    const reachTeam = teamNameById.get(reach.teamId) ?? "One team";
    sentences.push(
      `The biggest reach: ${reachTeam} paid $${reach.price} for ${reach.name}, ${formatSigned(reachValue ?? 0)} over market value.`,
    );
  } else if (
    reach &&
    !report.isAuction &&
    (reachValue ?? 0) <= -ADP_SURPLUS_THRESHOLD
  ) {
    const reachTeam = teamNameById.get(reach.teamId) ?? "One team";
    sentences.push(
      `The biggest reach: ${reachTeam} took ${reach.name} at pick #${reach.slot}, ${formatSignedNumber(reachValue ?? 0)} spots ahead of his ADP.`,
    );
  }

  if (report.mostReliableRoster) {
    sentences.push(
      `${report.mostReliableRoster.teamName} built the most reliable roster, with ${report.mostReliableRoster.count} steady performers from last season.`,
    );
  }
  if (report.mostVolatileRoster) {
    sentences.push(
      `${report.mostVolatileRoster.teamName} is rostering the most boom/bust talent in the league (${report.mostVolatileRoster.count} players).`,
    );
  }

  return sentences.join(" ");
}
