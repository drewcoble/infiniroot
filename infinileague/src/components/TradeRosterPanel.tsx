import { Stack, Text } from "@mantine/core";
import { PlayerCard } from "./PlayerCard";
import type { RosVorRow, TeamRosterRow } from "../types/season";
import type { TradeValueMetric } from "../lib/tradeAnalyzer";

interface TradeRosterPanelProps {
  rows: TeamRosterRow[];
  vorByFpid: Map<number, RosVorRow>;
  metric: TradeValueMetric;
  selected: Set<number>;
  onToggle: (fpid: number) => void;
}

// A player just off the rosVOR board's cutoff (rare - see freeAgents.tsx's
// identical fallback) still needs a row PlayerCard can render - zeroed
// value fields rather than a second bespoke layout. rosteredByTeamName is
// never actually shown (see showRosteredBy below), so it's just null here.
function toFallbackRow(row: TeamRosterRow, fpid: number): RosVorRow {
  return {
    fpid,
    name: row.name ?? "",
    team: row.team ?? null,
    position: row.position ?? "QB",
    rosVor: 0,
    rosRank: 0,
    actualVor: 0,
    actualRank: 0,
    positionRank: 0,
    rosPpg: 0,
    actualPpg: 0,
    rosteredByTeamName: null,
    ...(row.injury ? { injury: row.injury } : {}),
  };
}

// Your own team's checkbox-selectable roster for the Trade tab, shown alone
// while no opponent is picked yet (or their roster is still loading) - once
// both teams are loaded, trade.tsx switches to TradeRosterMatchup's paired
// rows instead, which line each team's players up against each other by
// roster slot rather than stacking them in two separate lists. Same
// PlayerCard every other player list in the app uses, swapping its default
// PPG stat for this player's own rosVOR/actualVOR (the trade math's actual
// currency, see src/lib/tradeAnalyzer.ts) via rightStats. No slot badge or
// rostered-by text here - TradeRosterMatchup owns the slot label once it
// has both teams to put it between, and rostered-by is redundant on a page
// that's already grouped by team. Unfilled slots and IR/TAXI players aren't
// tradeable pieces, so they're left out entirely rather than rendered
// disabled - same eligibility buildTradePool uses.
export function TradeRosterPanel({ rows, vorByFpid, metric, selected, onToggle }: TradeRosterPanelProps) {
  const tradeableRows = rows.filter(
    (row) => row.fpid !== undefined && row.slot !== "IR" && row.slot !== "TAXI",
  );
  const metricLabel = metric === "rosVor" ? "ROS VOR" : "VOR";

  return (
    <Stack gap={8}>
      {tradeableRows.map((row) => {
        const fpid = row.fpid as number;
        const vorRow = vorByFpid.get(fpid);
        const value = vorRow?.[metric] ?? 0;
        return (
          <PlayerCard
            key={fpid}
            row={vorRow ?? toFallbackRow(row, fpid)}
            isRookie={row.isRookie ?? false}
            showRosteredBy={false}
            checkbox={{ checked: selected.has(fpid), onChange: () => onToggle(fpid) }}
            rightStats={
              <Text size="xs" c="dimmed">
                {value.toFixed(1)} {metricLabel}
              </Text>
            }
          />
        );
      })}
    </Stack>
  );
}
