import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Alert, Center, Loader, Stack, Text } from "@mantine/core";
import { evaluate, type DraftPhase, type StageResult } from "@playoffRules/evaluate";
import type { GroupStage, PlayoffFormat, Stage } from "@playoffRules/format";
import { GlassSegmented } from "@shared/glass/GlassSegmented";
import { TournamentBracket, type BracketTeam } from "@shared/glass/TournamentBracket";
import bracketClasses from "@shared/glass/TournamentBracket.module.css";
import { DoubleElimView } from "../../../components/DoubleElimView";
import { GroupCard, type GroupTeam } from "../../../components/GroupCard";
import { TeamRow } from "../../../components/TeamRow";
import { ifEndedTodayInput, stageTournament, stageWeeks } from "../../../lib/bracketView";
import { currentInput } from "../../../lib/engineInput";
import { useSeasonData, type SeasonData } from "../../../lib/seasonData";

export const Route = createFileRoute("/league/$leagueId/bracket")({
  component: BracketPage,
});

// The stage to open on: the latest one whose weeks have started, else the
// first.
function defaultStage(format: PlayoffFormat, currentWeek: number): string {
  const started = format.stages.filter((stage) => Math.min(...stageWeeks(stage)) <= currentWeek);
  return (started[started.length - 1] ?? format.stages[0])?.id ?? "";
}

function draftNote(
  phase: DraftPhase | undefined,
  teams: ReadonlyMap<string, GroupTeam>,
): string | null {
  const name = (teamId: string) => teams.get(teamId)?.name ?? "A team";
  switch (phase?.phase) {
    case "slots":
      return `Matchup draft: ${name(phase.drafterId)} is choosing a draft slot`;
    case "picks":
      return `Matchup draft: ${name(phase.drafterId)} is on the clock (pick ${phase.pickNumber})`;
    case "rematches":
      return `Waiting on rematch picks for week ${phase.pending[0]?.week ?? ""}`;
    default:
      return null;
  }
}

// Every stage of the league's playoffs - groups as tables with their games,
// brackets as the swipeable glass bracket. Before the regular season ends
// it's the picture if it ended today. A league without custom rules shows
// its platform's own bracket.
function BracketPage() {
  const { data, error, rules, format, isCustom } = useSeasonData();
  const [manualStage, setManualStage] = useState<string | null>(null);

  const evaluated = useMemo(() => {
    if (!data || !format) return undefined;
    const input = currentInput(data, format, rules);
    return {
      state: evaluate(format, ifEndedTodayInput(format, input)),
      ifEndedToday: data.finalThroughWeek < format.regularSeasonEndWeek,
    };
  }, [data, format, rules]);

  if (error) return <Alert color="red">{error}</Alert>;
  if (!data || format === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }
  if (format === null) return <Text c="dimmed">This league doesn't have playoffs.</Text>;

  const tierOf = new Map(evaluated?.state.standings.map((row) => [row.teamId, row.tier]));
  const teams = new Map<string, GroupTeam & BracketTeam>(
    data.teams.map((team) => [
      team.teamId,
      {
        name: team.name,
        logoUrl: team.logoUrl,
        isMine: team.isMine,
        tier: tierOf.get(team.teamId) ?? null,
      },
    ]),
  );

  if (!isCustom) return <PlatformBracket data={data} teams={teams} />;
  if (!evaluated) return null;

  const stageId = manualStage ?? defaultStage(format, data.currentWeek);
  const stage = format.stages.find((s) => s.id === stageId) ?? format.stages[0];
  const result = stage && evaluated.state.stages[stage.id];

  return (
    <Stack gap="md">
      {format.stages.length > 1 && (
        <GlassSegmented
          label="Stage"
          value={stage?.id ?? ""}
          onChange={setManualStage}
          options={format.stages.map((s) => ({ value: s.id, label: s.name }))}
        />
      )}
      {evaluated.ifEndedToday && (
        <div className={bracketClasses.note}>
          If the season ended today · regular season ends week {format.regularSeasonEndWeek}
        </div>
      )}
      {stage && result && (
        <StageView
          stage={stage}
          result={result}
          format={format}
          teams={teams}
          currentWeek={data.currentWeek}
        />
      )}
    </Stack>
  );
}

function StageView({
  stage,
  result,
  format,
  teams,
  currentWeek,
}: {
  stage: Stage;
  result: StageResult;
  format: PlayoffFormat;
  teams: ReadonlyMap<string, GroupTeam & BracketTeam>;
  currentWeek: number;
}) {
  if (stage.kind === "groups") {
    return <GroupsView stage={stage} result={result} format={format} teams={teams} />;
  }
  if (stage.kind === "points") {
    return (
      <Stack gap={8}>
        {(result.table ?? []).map((row, index) => {
          const team = teams.get(row.teamId);
          return (
            <TeamRow
              key={row.teamId}
              data={{
                teamId: row.teamId,
                name: team?.name ?? "Unknown team",
                rank: index + 1,
                isMine: team?.isMine ?? false,
                primary: row.points.toFixed(1),
                stats: [],
              }}
            />
          );
        })}
      </Stack>
    );
  }
  if (stage.kind === "doubleElim") {
    return (
      <DoubleElimView stage={stage} result={result} teams={teams} currentWeek={currentWeek} />
    );
  }
  const tournament = stageTournament(result);
  // A toilet bowl's last team standing finished last - no trophy.
  if (stage.loserAdvances) tournament.championTeamId = null;
  return (
    // Remounted per stage: the bracket sets up its swipe position once.
    <TournamentBracket
      key={stage.id}
      tournament={tournament}
      teams={teams}
      currentWeek={currentWeek}
    />
  );
}

function GroupsView({
  stage,
  result,
  format,
  teams,
}: {
  stage: GroupStage;
  result: StageResult;
  format: PlayoffFormat;
  teams: ReadonlyMap<string, GroupTeam>;
}) {
  const groups = result.groups ?? [];
  const groupSize = Math.ceil((result.entrants?.length ?? 0) / Math.max(stage.groupCount, 1));
  const note = draftNote(result.draft, teams);
  // In the format's tier order - the stored bonus map's key order isn't kept.
  const byTier = stage.bonus?.byTier ?? {};
  const bonuses = format.tiers.flatMap((tier) =>
    byTier[tier.name] !== undefined ? [`${tier.name} +${byTier[tier.name]}`] : [],
  );
  const bonusLine = Object.values(byTier).some((bonus) => bonus !== 0)
    ? `Weekly bonus: ${bonuses.join(" · ")}`
    : null;
  if (groups.length === 0) {
    return <div className={bracketClasses.note}>Groups are set when the regular season ends.</div>;
  }
  return (
    <Stack gap="md">
      {note && <div className={bracketClasses.note}>{note}</div>}
      {groups.map((group, index) => {
        const head = group.headId ? teams.get(group.headId)?.name : undefined;
        return (
          <GroupCard
            key={group.headId ?? index}
            title={head ? `${head}'s group` : `Group ${String.fromCharCode(65 + index)}`}
            bonusLine={bonusLine}
            group={group}
            groupSize={groupSize}
            weeks={stage.weeks}
            advancePerGroup={stage.advancePerGroup}
            teams={teams}
            format={format}
          />
        );
      })}
    </Stack>
  );
}

// No custom rules: the platform's own bracket, seeded from today's
// standings until the platform sets it.
function PlatformBracket({
  data,
  teams,
}: {
  data: SeasonData;
  teams: ReadonlyMap<string, BracketTeam>;
}) {
  const playoffs = data.platformPlayoffs;
  const tournament = playoffs?.tournaments[0];
  if (!playoffs?.hasPlayoffs || !tournament) {
    return <Text c="dimmed">This league doesn't have playoffs.</Text>;
  }
  if (tournament.rounds.length === 0) {
    return (
      <div className={bracketClasses.note}>
        Bracket is set after week {playoffs.regularSeasonEndWeek}.
      </div>
    );
  }
  return (
    <Stack gap="md">
      {playoffs.phase === "regular" && (
        <div className={bracketClasses.note}>
          If the season ended today · starts week {playoffs.regularSeasonEndWeek + 1}
        </div>
      )}
      <TournamentBracket tournament={tournament} teams={teams} currentWeek={playoffs.currentWeek} />
    </Stack>
  );
}
