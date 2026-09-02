import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";

type ActionKey = "sync" | "playerPoints";

interface ActionState {
  isRunning: boolean;
  status: { kind: "success" | "error"; message: string } | null;
}

const IDLE_STATE: ActionState = { isRunning: false, status: null };

// "0" is infinidraft's own draft/season-long sentinel (see
// src/constants/general.ts's WEEK) - every draft-app page reads it, since
// drafting is always done against season-long projections regardless of
// what week it actually is. This panel is different: it's also the manual
// trigger for the same sync the nightly cron runs (see convex/fetchAllData.ts
// and convex/crons.ts), which infinileague depends on for in-season,
// per-week projections - so unlike the rest of the app, this one needs a
// real week selector rather than always hardcoding "0".
const WEEK_OPTIONS = [
  { value: "0", label: "0 (Draft / season-long)" },
  ...Array.from({ length: 18 }, (_, i) => ({
    value: String(i + 1),
    label: `Week ${i + 1}`,
  })),
];

// Down to 2 buttons (was 6 - players/rankings/injuries, ESPN id links, ESPN
// values, blend, and value caches were all separate steps that had to be run
// in a specific order to actually update anything - see this file's own git
// history). fetchAllData.fetchAll now runs that whole pipeline itself in the
// right order (it's also what the nightly cron calls - see convex/crons.ts),
// so "Sync all data" is just that. Player points stays separate since it's
// the one action here with a genuinely different scope - actual per-week
// results for a specific (optionally past) season, not this week's
// projections/rankings.
export function DataPanel() {
  const fetchAll = useAction(api.fetchAllData.fetchAll);
  const fetchPlayerPoints = useAction(
    api.sleeper.playerPoints.fetchAllPlayerPoints,
  );

  // Defaults to whatever the last sync detected as the live NFL week (see
  // convex/nflState.ts, upserted by fetchAllData regardless of which week it
  // was asked to sync) - "0" outside the regular season, same rule
  // fetchCurrentNflWeek itself uses server-side. Only a starting value for
  // the dropdown; picking a different week doesn't get overwritten once set.
  const nflState = useQuery(api.nflState.getNflState, {});
  const [week, setWeek] = useState<string | null>(null);
  useEffect(() => {
    if (week !== null || nflState === undefined) return;
    setWeek(nflState?.seasonType === "regular" ? nflState.week : "0");
  }, [nflState, week]);

  // Defaults to the current season server-side (see fetchAllPlayerPoints)
  // when left blank - only needs to be filled in to backfill a past season
  // (e.g. to populate the new per-week stats field for the player detail
  // modal's game log on seasons already in the database).
  const [playerPointsYear, setPlayerPointsYear] = useState("");

  const [states, setStates] = useState<Record<ActionKey, ActionState>>({
    sync: IDLE_STATE,
    playerPoints: IDLE_STATE,
  });

  // Only rendered once the week selector has its starting value (see the
  // effect above) - the actions below assume a real string, not the
  // momentary null before that resolves.
  if (week === null) return <Loader />;

  const actions: Array<{
    key: ActionKey;
    label: string;
    description: string;
    run: () => Promise<unknown>;
    successMessage: string | ((result: unknown) => string);
  }> = [
    {
      key: "sync",
      label: "Sync all data",
      description:
        "Runs the full pipeline for the selected week: players, projections (Sleeper + ESPN blended), ADP/rankings, injuries, and the value-gap/$-value caches. Same job the nightly cron runs - for an in-season week, it also schedules background jobs to backfill every later week.",
      run: () => fetchAll({ week }),
      successMessage: `Synced for week "${week}".`,
    },
    {
      key: "playerPoints",
      label: "Fetch player points",
      description:
        "Actual scored fantasy points, per week. Leave the year blank for the current season (also covered by \"Sync all data\") - fill it in to backfill a past season.",
      run: () =>
        fetchPlayerPoints(
          playerPointsYear.trim() ? { year: playerPointsYear.trim() } : {},
        ),
      successMessage: `Player points refreshed${
        playerPointsYear.trim() ? ` for ${playerPointsYear.trim()}` : ""
      }.`,
    },
  ];

  const runAction = async (action: (typeof actions)[number]) => {
    setStates((prev) => ({
      ...prev,
      [action.key]: { isRunning: true, status: null },
    }));

    try {
      const result = await action.run();
      const message =
        typeof action.successMessage === "function"
          ? action.successMessage(result)
          : action.successMessage;
      setStates((prev) => ({
        ...prev,
        [action.key]: {
          isRunning: false,
          status: { kind: "success", message },
        },
      }));
    } catch (error) {
      const message = getErrorMessage(error, "Something went wrong.");
      setStates((prev) => ({
        ...prev,
        [action.key]: { isRunning: false, status: { kind: "error", message } },
      }));
    }
  };

  return (
    <Stack gap="md" py="sm">
      <Select
        label="Week"
        description={
          'Which week "Sync all data" below fetches. Defaults to the detected current NFL week; "Fetch player points" is unaffected (it covers every week of a season at once).'
        }
        data={WEEK_OPTIONS}
        value={week}
        onChange={(value) => value && setWeek(value)}
        allowDeselect={false}
        w={260}
      />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        {actions.map((action) => {
          const state = states[action.key];
          return (
            <Card key={action.key} withBorder padding="md">
              <Stack gap="sm" justify="space-between" h="100%">
                <Stack gap={4}>
                  <Text fw={500}>{action.label}</Text>
                  <Text size="sm" c="dimmed">
                    {action.description}
                  </Text>
                </Stack>
                <Stack gap="xs">
                  {action.key === "playerPoints" && (
                    <TextInput
                      placeholder="Year (optional)"
                      value={playerPointsYear}
                      onChange={(event) =>
                        setPlayerPointsYear(event.currentTarget.value)
                      }
                    />
                  )}
                  <Group justify="space-between" align="center">
                    <Button
                      onClick={() => runAction(action)}
                      loading={state.isRunning}
                    >
                      {action.label}
                    </Button>
                  </Group>
                  {state.status && (
                    <Alert
                      color={state.status.kind === "success" ? "green" : "red"}
                      variant="light"
                    >
                      {state.status.message}
                    </Alert>
                  )}
                </Stack>
              </Stack>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
