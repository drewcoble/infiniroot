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
  // Shown as this player's "rostered by" line when there's no vorByFpid
  // match (see toFallbackRow below) - the real RosVorRow already carries its
  // own correct rosteredByTeamName in the common case.
  teamName: string;
}

function slotLabel(slot: TeamRosterRow["slot"]): string {
  if (slot === undefined) return "";
  if (slot === "BENCH") return "BN";
  if (slot === "SUPERFLEX") return "SFLEX";
  return slot;
}

// A player just off the rosVOR board's cutoff (rare - see freeAgents.tsx's
// identical fallback) still needs a row PlayerCard can render - zeroed
// value fields rather than a second bespoke layout.
function toFallbackRow(row: TeamRosterRow, fpid: number, teamName: string): RosVorRow {
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
    rosteredByTeamName: teamName,
    ...(row.injury ? { injury: row.injury } : {}),
  };
}

// One team's checkbox-selectable roster for the Trade tab - same PlayerCard
// every other player list in the app uses (see PlayerCard.tsx's own
// comment), swapping its default PPG stat for this player's own rosVOR/
// actualVOR (the trade math's actual currency, see src/lib/tradeAnalyzer.ts)
// via rightStats, and a leading checkbox (via PlayerCard's checkbox prop)
// for picking which players move. Unfilled slots and IR/TAXI players aren't
// tradeable pieces, so they're left out entirely rather than rendered
// disabled - same eligibility buildTradePool uses.
export function TradeRosterPanel({
  rows,
  vorByFpid,
  metric,
  selected,
  onToggle,
  teamName,
}: TradeRosterPanelProps) {
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
            row={vorRow ?? toFallbackRow(row, fpid, teamName)}
            isRookie={row.isRookie ?? false}
            leftLabel={slotLabel(row.slot)}
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
