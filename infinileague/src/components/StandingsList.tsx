import { Stack } from "@mantine/core";
import { GlassTeamCard } from "./cards/GlassTeamCard";
import type { StandingsRow, TeamPositionRanks } from "../types/season";

interface StandingsListProps {
  leagueId: string;
  rows: StandingsRow[];
  // Every team's position ranks for the long-press popover's radar chart -
  // one shared fetch for the whole league (see the league index page).
  positionRanksByTeam: Map<string, TeamPositionRanks> | undefined;
}

function seasonPpg(row: StandingsRow): number | null {
  const games = row.wins + row.losses + row.ties;
  return games > 0 ? row.pointsFor / games : null;
}

// Ranked by win percentage, points scored as tiebreaker - both already
// computed/sorted server-side (see convex/season/standings.ts's
// getStandings), this just renders the rows in the order they arrive.
// Exactly one of faabRemaining/waiverPosition is set per row (chosen by the
// season's waiverType), so the label is derived per-row rather than once.
export function StandingsList({ leagueId, rows, positionRanksByTeam }: StandingsListProps) {
  return (
    <Stack gap={8}>
      {rows.map((row) => {
        const ppg = seasonPpg(row);
        const waiver =
          row.faabRemaining !== undefined
            ? `$${row.faabRemaining} FAAB`
            : `Waiver #${row.waiverPosition ?? "—"}`;
        return (
          <GlassTeamCard
            key={row.teamId}
            data={{
              leagueId,
              teamId: row.teamId,
              name: row.name,
              rank: row.rank,
              isSelf: row.isSelf,
              primary: `${row.wins}-${row.losses}-${row.ties}`,
              secondaryLeft: (
                <span className="num">{ppg !== null ? `${ppg.toFixed(1)} PPG` : "—"}</span>
              ),
              secondaryRight: waiver,
              stats: [
                { label: "Record", value: `${row.wins}-${row.losses}-${row.ties}` },
                { label: "PPG", value: ppg !== null ? ppg.toFixed(1) : "—" },
                {
                  label: row.faabRemaining !== undefined ? "FAAB" : "Waiver",
                  value:
                    row.faabRemaining !== undefined
                      ? `$${row.faabRemaining}`
                      : `#${row.waiverPosition ?? "—"}`,
                },
                { label: "Points for", value: row.pointsFor.toFixed(1) },
                { label: "Points against", value: row.pointsAgainst.toFixed(1) },
              ],
            }}
            positionRanks={positionRanksByTeam?.get(row.teamId)}
            totalTeams={rows.length}
          />
        );
      })}
    </Stack>
  );
}
