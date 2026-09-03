import { Stack, Text } from "@mantine/core";
import { TeamCard } from "./TeamCard";
import type { StandingsRow } from "../types/season";

interface StandingsListProps {
  leagueId: string;
  rows: StandingsRow[];
}

// Ranked by win percentage, points scored as tiebreaker - both already
// computed/sorted server-side (see convex/season/standings.ts's
// getStandings), this just renders the rows in the order they arrive.
// Exactly one of faabRemaining/waiverPosition is set per row (chosen by the
// season's waiverType), so the label is derived per-row rather than once.
export function StandingsList({ leagueId, rows }: StandingsListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row) => (
        <TeamCard
          key={row.teamId}
          leagueId={leagueId}
          teamId={row.teamId}
          name={row.name}
          isSelf={row.isSelf}
          leftLabel={row.rank}
          stats={
            <>
              <Text size="sm" fw={500}>
                {row.wins}-{row.losses}-{row.ties}
              </Text>
              <Text size="xs" c="dimmed">
                {row.pointsFor.toFixed(1)} PF / {row.pointsAgainst.toFixed(1)} PA
              </Text>
              <Text size="xs" c="dimmed">
                {row.faabRemaining !== undefined
                  ? `$${row.faabRemaining} FAAB`
                  : `Waiver #${row.waiverPosition ?? "—"}`}
              </Text>
            </>
          }
        />
      ))}
    </Stack>
  );
}
