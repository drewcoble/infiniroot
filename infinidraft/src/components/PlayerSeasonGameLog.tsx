import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Badge, Center, Loader, Stack, Table, Text, Tooltip } from "@mantine/core";
import { api } from "@infinidata/api";
import type { ScoringFormat } from "../types";
import { injuryColor } from "@shared/injuryColor";
import { formatStatKey } from "../lib/playerFormatting";

interface PlayerSeasonGameLogProps {
  fpid: number;
  season: string;
  scoring: ScoringFormat;
  // Gates the query - a closed accordion panel never fetches anything,
  // matching PlayerDetailModal's "only load what's actually opened" design.
  isOpen: boolean;
}

export function PlayerSeasonGameLog({
  fpid,
  season,
  scoring,
  isOpen,
}: PlayerSeasonGameLogProps) {
  const gameLog = useQuery(
    api.playerPoints.getPlayerGameLog,
    isOpen ? { fpid, season, scoring } : "skip",
  );
  // Injury history only exists going forward from whenever that table
  // shipped - seasons before that (or before a change was ever recorded)
  // simply won't have any rows here, which is expected, not an error.
  const injurySnapshots = useQuery(
    api.injurySnapshots.getSeasonSnapshots,
    isOpen ? { fpid, season } : "skip",
  );

  // A week can have more than one recorded change (see the schema comment
  // on injurySnapshots) - grouped and sorted oldest-first so the "first"
  // entry for a week is the one closest to that week's earliest games
  // (e.g. a Thursday designation), not whatever happened to be fetched last.
  const snapshotsByWeek = useMemo(() => {
    const map = new Map<string, NonNullable<typeof injurySnapshots>>();
    for (const snapshot of injurySnapshots ?? []) {
      const list = map.get(snapshot.week) ?? [];
      list.push(snapshot);
      map.set(snapshot.week, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.fetchedAt - b.fetchedAt);
    }
    return map;
  }, [injurySnapshots]);

  // Union of nonzero stat keys across the season's games - same trimming
  // approach PlayersTable.tsx uses for its statKeys, so a week with no
  // rushing stats doesn't force an all-zero "Rush Yd" column onto every
  // other week's row. Rows written before the stats field existed have no
  // `stats` at all - treated as empty rather than erroring.
  const statKeys = useMemo(() => {
    if (!gameLog || gameLog.length === 0) return [];
    const keys = new Set<string>();
    for (const row of gameLog) {
      for (const key of Object.keys(row.stats ?? {})) keys.add(key);
    }
    return Array.from(keys).filter((key) =>
      gameLog.some((row) => (row.stats?.[key] ?? 0) > 0),
    );
  }, [gameLog]);

  if (!isOpen) return null;

  if (gameLog === undefined) {
    return (
      <Center py="md">
        <Loader size="sm" />
      </Center>
    );
  }

  if (gameLog.length === 0) {
    return (
      <Text size="sm" c="dimmed" py="xs">
        No games recorded for {season}.
      </Text>
    );
  }

  // Table.ScrollContainer's minWidth forces the horizontal-scroll wrapper to
  // actually be that wide - if it's narrower than the columns need (the
  // previous hardcoded 280px, vs. up to ~20 stat columns for some
  // positions), the table's own `width: 100%` squeezes every column down to
  // fit anyway, wrapping headers letter-by-letter instead of scrolling.
  // ~64px/column is a rough floor for a header like "Cmp" or a stat value.
  const columnCount = 3 + statKeys.length;
  const minWidth = Math.max(280, columnCount * 64);
  const noWrap = { whiteSpace: "nowrap" as const };

  return (
    <Table.ScrollContainer minWidth={minWidth}>
      <Table verticalSpacing={4}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th style={noWrap}>Wk</Table.Th>
            <Table.Th style={noWrap}>Status</Table.Th>
            <Table.Th style={noWrap}>Pts</Table.Th>
            {statKeys.map((key) => (
              <Table.Th key={key} style={noWrap}>
                {formatStatKey(key)}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {gameLog.map((row) => {
            const weekSnapshots = snapshotsByWeek.get(row.week) ?? [];
            const first = weekSnapshots[0];
            return (
              <Table.Tr key={row._id}>
                <Table.Td style={noWrap}>{row.week}</Table.Td>
                <Table.Td style={noWrap}>
                  {first && (
                    <Tooltip
                      disabled={weekSnapshots.length < 2}
                      multiline
                      w={220}
                      label={
                        <Stack gap={2}>
                          {weekSnapshots.map((snap) => (
                            <Text key={snap._id} size="xs">
                              {snap.statusShort}
                              {snap.injuryType ? ` (${snap.injuryType})` : ""}
                            </Text>
                          ))}
                        </Stack>
                      }
                    >
                      <Badge
                        color={injuryColor(first.status)}
                        size="sm"
                        variant="light"
                      >
                        {first.statusShort}
                      </Badge>
                    </Tooltip>
                  )}
                </Table.Td>
                <Table.Td style={noWrap}>{row.points.toFixed(1)}</Table.Td>
                {statKeys.map((key) => (
                  <Table.Td key={key} style={noWrap}>
                    {row.stats?.[key] ?? "—"}
                  </Table.Td>
                ))}
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
