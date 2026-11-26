import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Button, Group, MultiSelect, Select, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import { evaluate } from "@playoffRules/evaluate";
import type { GroupStage, ManualGroups, PlayoffFormat } from "@playoffRules/format";
import { manualGroupsProblem } from "@playoffRules/validate";
import { getErrorMessage } from "@shared/errors";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { ifEndedTodayInput } from "../lib/bracketView";
import { currentInput, manualGroupsByStage } from "../lib/engineInput";
import type { PlayoffRules, SeasonData } from "../lib/seasonData";

// One week's games in the form - a side is null until it's picked.
type FormPair = [string | null, string | null];

interface FormGroup {
  teamIds: string[];
  // Week -> one row per game the group plays that week.
  weeks: Record<number, FormPair[]>;
}

const groupLabel = (index: number) => `Group ${String.fromCharCode(65 + index)}`;

// A week's rows for a group of `teamIds`: the games already set between
// group-mates, then blank rows up to one per pair of teams.
function fitRows(rows: FormPair[], teamIds: string[]): FormPair[] {
  const members = new Set(teamIds);
  const kept = rows.map(
    ([a, b]): FormPair => [a && members.has(a) ? a : null, b && members.has(b) ? b : null],
  );
  const count = Math.floor(teamIds.length / 2);
  const filled = kept.filter(([a, b]) => a !== null || b !== null).slice(0, count);
  while (filled.length < count) filled.push([null, null]);
  return filled;
}

function toForm(manual: ManualGroups, stage: GroupStage): FormGroup[] {
  const groups = Array.from({ length: stage.groupCount }, (_, g) => manual.groups[g]);
  return groups.map((group) => {
    const teamIds = group?.teamIds ?? [];
    const weeks: Record<number, FormPair[]> = {};
    for (const week of stage.weeks) {
      const rows = (group?.pairs ?? [])
        .filter((pair) => pair.week === week)
        .map((pair): FormPair => [pair.teamIds[0], pair.teamIds[1]]);
      weeks[week] = fitRows(rows, teamIds);
    }
    return { teamIds, weeks };
  });
}

function fromForm(form: FormGroup[], stage: GroupStage): ManualGroups {
  return {
    groups: form.map((group) => ({
      teamIds: group.teamIds,
      pairs: stage.weeks.flatMap((week) =>
        (group.weeks[week] ?? []).flatMap(([a, b]) =>
          a !== null && b !== null ? [{ week, teamIds: [a, b] as [string, string] }] : [],
        ),
      ),
    })),
  };
}

// The commissioner's override for one group stage: who's in each group and
// who plays whom each week, in place of the matchup draft or the seeded
// deal. Starts from the groups as they stand, so a tweak is a tweak.
export function GroupsEditor({
  seasonId,
  stage,
  format,
  data,
  rules,
}: {
  seasonId: Id<"seasons">;
  stage: GroupStage;
  format: PlayoffFormat;
  data: SeasonData;
  rules: PlayoffRules;
}) {
  const setManualGroups = useMutation(api.infiniyoffs.rules.setManualGroups);
  const saved = manualGroupsByStage(rules)[stage.id] ?? null;
  const [form, setForm] = useState<FormGroup[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(
    () => new Map(data.teams.map((team) => [team.teamId as string, team.name])),
    [data.teams],
  );

  // The groups as they stand (the same picture the bracket page shows), and
  // who the rules alone would put in the stage.
  const { current, ruleEntrants } = useMemo(() => {
    const input = ifEndedTodayInput(format, currentInput(data, format, rules));
    const shown = evaluate(format, input).stages[stage.id];
    const byRules = evaluate(format, { ...input, manualGroups: {} }).stages[stage.id];
    const groups: ManualGroups = {
      groups: (shown?.groups ?? []).map((group) => ({
        teamIds: group.teamIds,
        pairs: group.games.flatMap((game) => {
          const [a, b] = game.teamIds;
          const week = game.weeks[0];
          return a && b && week !== undefined ? [{ week, teamIds: [a, b] as [string, string] }] : [];
        }),
      })),
    };
    return { current: groups, ruleEntrants: byRules?.entrants ?? null };
  }, [data, format, rules, stage.id]);

  const formation = stage.formation.kind === "matchupDraft" ? "matchup draft" : "seeding";

  const save = async (groups: ManualGroups | null) => {
    setSaving(true);
    setError(null);
    try {
      await setManualGroups({
        seasonId,
        stageId: stage.id,
        groups:
          groups &&
          groups.groups.map((group) => ({
            teamIds: group.teamIds as Id<"seasonTeams">[],
            pairs: group.pairs.map((pair) => ({
              week: pair.week,
              teamIds: pair.teamIds as Id<"seasonTeams">[],
            })),
          })),
      });
      setForm(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save the groups."));
    } finally {
      setSaving(false);
    }
  };

  if (form === null) {
    return (
      <div className={glass.card}>
        <Stack gap="sm" p={4}>
          <span className={glass.sectionLabel}>Groups & matchups · {stage.name}</span>
          <Text size="sm" c="dimmed">
            {saved
              ? `Set by hand - these groups and games replace the ${formation}.`
              : `Set by the ${formation}. Set them by hand to override who's in each ` +
                "group and who plays whom each week."}
          </Text>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Group justify="flex-end" gap="xs">
            {saved && (
              <Button variant="subtle" loading={saving} onClick={() => void save(null)}>
                Back to the {formation}
              </Button>
            )}
            <Button onClick={() => setForm(toForm(saved ?? current, stage))}>
              {saved ? "Edit groups" : "Set by hand"}
            </Button>
          </Group>
        </Stack>
      </div>
    );
  }

  const built = fromForm(form, stage);
  const problem = manualGroupsProblem(
    stage,
    built,
    data.teams.map((team) => team.teamId),
  );
  const unset = form.reduce(
    (count, group) =>
      count +
      stage.weeks.filter((week) => (group.weeks[week] ?? []).some(([a, b]) => !a || !b)).length,
    0,
  );
  const placed = form.flatMap((group) => group.teamIds);
  const added = ruleEntrants ? placed.filter((teamId) => !ruleEntrants.includes(teamId)) : [];
  const left = ruleEntrants ? ruleEntrants.filter((teamId) => !placed.includes(teamId)) : [];
  const names = (teamIds: string[]) => teamIds.map((id) => nameOf.get(id) ?? "?").join(", ");

  const setGroupTeams = (g: number, teamIds: string[]) =>
    setForm(
      form.map((group, i) =>
        i !== g
          ? group
          : {
              teamIds,
              weeks: Object.fromEntries(
                stage.weeks.map((week) => [week, fitRows(group.weeks[week] ?? [], teamIds)]),
              ),
            },
      ),
    );

  const setSide = (g: number, week: number, row: number, side: 0 | 1, teamId: string | null) =>
    setForm(
      form.map((group, i) => {
        if (i !== g) return group;
        const rows = (group.weeks[week] ?? []).map((pair): FormPair => [...pair]);
        const edited = rows[row];
        if (!edited) return group;
        edited[side] = teamId;
        // In a group of four, one game fixes the other.
        if (group.teamIds.length === 4 && rows.length === 2 && edited[0] && edited[1]) {
          const rest = group.teamIds.filter((id) => id !== edited[0] && id !== edited[1]);
          rows[row === 0 ? 1 : 0] = [rest[0] ?? null, rest[1] ?? null];
        }
        return { ...group, weeks: { ...group.weeks, [week]: rows } };
      }),
    );

  return (
    <div className={glass.card}>
      <Stack gap="md" p={4}>
        <span className={glass.sectionLabel}>Groups & matchups · {stage.name}</span>
        <Text size="xs" c="dimmed">
          The first team listed heads its group.
        </Text>
        {form.map((group, g) => {
          const elsewhere = new Set(form.flatMap((other, i) => (i === g ? [] : other.teamIds)));
          const options = group.teamIds.map((id) => ({ value: id, label: nameOf.get(id) ?? "?" }));
          return (
            <Stack key={g} gap="xs">
              <MultiSelect
                label={groupLabel(g)}
                placeholder="Pick teams"
                value={group.teamIds}
                searchable
                data={data.teams.map((team) => ({
                  value: team.teamId,
                  label: team.name,
                  disabled: elsewhere.has(team.teamId),
                }))}
                onChange={(teamIds) => setGroupTeams(g, teamIds)}
              />
              {group.teamIds.length >= 2 &&
                stage.weeks.map((week) => (
                  <Group key={week} gap={6} wrap="nowrap" align="center">
                    <Text size="xs" c="dimmed" w={40} className="num">
                      Wk {week}
                    </Text>
                    <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
                      {(group.weeks[week] ?? []).map(([a, b], row) => (
                        <Group key={row} gap={6} wrap="nowrap" grow>
                          <Select
                            size="xs"
                            placeholder="Team"
                            aria-label={`${groupLabel(g)} week ${week} game ${row + 1}, first team`}
                            value={a}
                            data={options}
                            onChange={(teamId) => setSide(g, week, row, 0, teamId)}
                          />
                          <Select
                            size="xs"
                            placeholder="Team"
                            aria-label={`${groupLabel(g)} week ${week} game ${row + 1}, second team`}
                            value={b}
                            data={options}
                            onChange={(teamId) => setSide(g, week, row, 1, teamId)}
                          />
                        </Group>
                      ))}
                    </Stack>
                  </Group>
                ))}
            </Stack>
          );
        })}

        {(added.length > 0 || left.length > 0) && (
          <Text size="sm" c="yellow">
            {[
              added.length > 0 && `Adds ${names(added)}`,
              left.length > 0 && `leaves out ${names(left)}`,
            ]
              .filter(Boolean)
              .join("; ")}{" "}
            - compared with who the rules put in {stage.name}.
          </Text>
        )}
        {problem ? (
          <Text size="sm" c="red">
            {problem}
          </Text>
        ) : (
          unset > 0 && (
            <Text size="xs" c="dimmed">
              Games left blank show as not set yet.
            </Text>
          )
        )}
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="space-between" wrap="nowrap">
          <Button variant="subtle" onClick={() => setForm(toForm(current, stage))}>
            Reset to {saved ? "saved" : `the ${formation}`}
          </Button>
          <Group gap="xs" wrap="nowrap">
            <Button variant="default" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              disabled={problem !== null}
              onClick={() => void save(built)}
            >
              Save groups
            </Button>
          </Group>
        </Group>
      </Stack>
    </div>
  );
}
