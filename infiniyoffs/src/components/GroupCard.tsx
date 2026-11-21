import type { GameResult, GroupResult } from "@playoffRules/evaluate";
import type { PlayoffFormat } from "@playoffRules/format";
import { TeamLogo } from "@shared/glass/TeamLogo";
import { useTeamLogoUrl } from "@shared/glass/teamLogos";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { TierPill } from "./TierPill";
import classes from "./GroupCard.module.css";

export interface GroupTeam {
  name: string;
  isMine: boolean;
  tier: string | null;
}

function record(row: { wins: number; losses: number; ties: number }): string {
  return row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
}

function Logo({ teamId, name, size }: { teamId: string; name: string; size: number }) {
  return <TeamLogo name={name} logoUrl={useTeamLogoUrl(teamId)} size={size} />;
}

// One group: the table (record, then the season points that break a tied
// record), its open spots while the draft runs, and every week's games -
// scores include the weekly bonus, stated once under the title.
export function GroupCard({
  title,
  bonusLine,
  group,
  groupSize,
  weeks,
  advancePerGroup,
  teams,
  format,
}: {
  title: string;
  // e.g. "Weekly bonus: S +15 · A +10 · B +5".
  bonusLine: string | null;
  group: GroupResult;
  groupSize: number;
  weeks: number[];
  advancePerGroup: number;
  teams: ReadonlyMap<string, GroupTeam>;
  format: PlayoffFormat;
}) {
  const settled = group.games.length > 0 && group.games.every((game) => game.final);
  const open = groupSize - group.teamIds.length;
  return (
    <div className={glass.card}>
      <div className={classes.header}>
        <span className={classes.title}>{title}</span>
        {settled && <span className={glass.sectionLabel}>Final</span>}
      </div>
      {bonusLine && <span className={classes.bonusLine}>{bonusLine}</span>}
      <div className={classes.table}>
        <span className={`${glass.sectionLabel} ${classes.columnLabel}`}>W-L</span>
        <span className={`${glass.sectionLabel} ${classes.columnLabel}`}>
          {group.table[0]?.tiebreakPoints !== null ? "Season pts" : "Pts"}
        </span>
        {group.table.map((row, index) => {
          const team = teams.get(row.teamId);
          const name = team?.name ?? "Unknown team";
          const rowClass = [
            settled && index < advancePerGroup && classes.advancing,
            team?.isMine && classes.mine,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={row.teamId} className={rowClass} style={{ display: "contents" }}>
              <span className={classes.position}>{index + 1}</span>
              <Logo teamId={row.teamId} name={name} size={24} />
              <span className={classes.team}>
                <span className={classes.name}>{name}</span>
                {team?.tier && <TierPill format={format} tier={team.tier} />}
              </span>
              <span className={classes.record}>{record(row)}</span>
              <span className={classes.points}>
                {(row.tiebreakPoints ?? row.points).toFixed(1)}
              </span>
            </div>
          );
        })}
        {open > 0 && (
          <span className={classes.open}>
            {open} {open === 1 ? "spot" : "spots"} to draft
          </span>
        )}
      </div>
      <div className={classes.divider} />
      <div className={classes.games}>
        {weeks.map((week) => {
          const games = group.games.filter((game) => game.weeks.includes(week));
          if (games.length === 0) {
            return (
              <div key={week} className={classes.game}>
                <span className={classes.week}>Wk {week}</span>
                <span className={classes.pending}>Not picked yet</span>
              </div>
            );
          }
          return games.map((game, index) => (
            <GameLine
              key={game.id}
              game={game}
              label={index === 0 ? `Wk ${week}` : ""}
              teams={teams}
            />
          ));
        })}
      </div>
    </div>
  );
}

// One game on a line: label (week), both teams, the score - the winner
// bold and the loser faded once final, "vs" before any points.
export function GameLine({
  game,
  label,
  teams,
}: {
  game: GameResult;
  label: string;
  teams: ReadonlyMap<string, GroupTeam>;
}) {
  const side = (index: 0 | 1) => {
    const teamId = game.teamIds[index];
    const name = (teamId && teams.get(teamId)?.name) ?? "TBD";
    const outcome =
      game.winnerId === null ? "" : game.winnerId === teamId ? classes.won : classes.lost;
    return (
      <span className={`${classes.side} ${index === 1 ? classes.sideRight : ""} ${outcome}`}>
        {teamId && <Logo teamId={teamId} name={name} size={20} />}
        <span className={classes.sideName}>{name}</span>
      </span>
    );
  };
  const [a, b] = game.points;
  const score =
    a === null && b === null ? "vs" : `${a?.toFixed(1) ?? "—"} – ${b?.toFixed(1) ?? "—"}`;
  return (
    <div className={classes.game}>
      <span className={classes.week}>{label}</span>
      {side(0)}
      <span className={classes.score}>{score}</span>
      {side(1)}
    </div>
  );
}
