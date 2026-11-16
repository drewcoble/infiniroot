import { Stack } from "@mantine/core";
import { Trophy } from "lucide-react";
import type { StageResult } from "@playoffRules/evaluate";
import type { DoubleElimStage } from "@playoffRules/format";
import { TeamLogo } from "@shared/glass/TeamLogo";
import { useTeamLogoUrl } from "@shared/glass/teamLogos";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import bracketClasses from "@shared/glass/TournamentBracket.module.css";
import { GameLine, type GroupTeam } from "./GroupCard";
import classes from "./GroupCard.module.css";

function Logo({ teamId, name, size }: { teamId: string; name: string; size: number }) {
  return <TeamLogo name={name} logoUrl={useTeamLogoUrl(teamId)} size={size} />;
}

// A double elimination week by week - each week's unbeaten (WB) and
// once-beaten (LB) games and byes - then the Royal Rumble's standings and
// the final, if a once-beaten team forces one.
export function DoubleElimView({
  stage,
  result,
  teams,
}: {
  stage: DoubleElimStage;
  result: StageResult;
  teams: ReadonlyMap<string, GroupTeam>;
}) {
  const de = result.doubleElim;
  const name = (teamId: string) => teams.get(teamId)?.name ?? "Team";
  if (!de) {
    return (
      <div className={bracketClasses.note}>
        The bracket is set when the regular season ends.
      </div>
    );
  }
  const championId = result.advancers?.[0] ?? null;
  const byeLine = (side: string, teamIds: string[]) =>
    teamIds.length ? `${side} bye: ${teamIds.map(name).join(", ")}` : null;

  return (
    <Stack gap="md">
      {championId && (
        <div className={`${glass.card} ${bracketClasses.champion}`}>
          <Trophy size={26} color="#facc15" />
          <Logo teamId={championId} name={name(championId)} size={32} />
          <div style={{ minWidth: 0 }}>
            <div className={glass.sectionLabel}>Champion</div>
            <div className={bracketClasses.championName}>{name(championId)}</div>
          </div>
        </div>
      )}

      {de.final && (
        <div className={glass.card}>
          <span className={classes.title}>Final · Week {stage.finalWeek}</span>
          <div className={classes.games}>
            <GameLine game={de.final} label="" teams={teams} />
          </div>
        </div>
      )}

      {de.rumble ? (
        <div className={glass.card}>
          <div className={classes.header}>
            <span className={classes.title}>Royal Rumble · Week {de.rumble.week}</span>
            {de.rumble.final && <span className={glass.sectionLabel}>Final</span>}
          </div>
          <span className={classes.bonusLine}>
            Top score wins. Unbeaten wins it all; anyone else earns a week {stage.finalWeek} final.
          </span>
          <div className={classes.table}>
            {de.rumble.entries.map((entry, index) => {
              const team = teams.get(entry.teamId);
              const rowClass = [
                de.rumble?.winnerId === entry.teamId && classes.advancing,
                team?.isMine && classes.mine,
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={entry.teamId} className={rowClass} style={{ display: "contents" }}>
                  <span className={classes.position}>{index + 1}</span>
                  <Logo teamId={entry.teamId} name={name(entry.teamId)} size={24} />
                  <span className={classes.team}>
                    <span className={classes.name}>{name(entry.teamId)}</span>
                  </span>
                  <span className={classes.record}>
                    {de.unbeaten.includes(entry.teamId) ? "0 L" : "1 L"}
                  </span>
                  <span className={classes.points}>
                    {entry.points !== null ? entry.points.toFixed(1) : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className={bracketClasses.note}>
          Royal Rumble week {stage.rumbleWeek} · {de.unbeaten.length} unbeaten,{" "}
          {de.onceBeaten.length} once beaten
        </div>
      )}

      {[...de.weeks].reverse().map((week) => {
        const byes = [
          byeLine("WB", week.byes.winners),
          byeLine("LB", week.byes.losers),
        ].filter(Boolean);
        return (
          <div key={week.week} className={glass.card}>
            <span className={classes.title}>Week {week.week}</span>
            <div className={classes.games}>
              {week.winners.map((game, index) => (
                <GameLine key={game.id} game={game} label={index === 0 ? "WB" : ""} teams={teams} />
              ))}
              {week.losers.map((game, index) => (
                <GameLine key={game.id} game={game} label={index === 0 ? "LB" : ""} teams={teams} />
              ))}
            </div>
            {byes.length > 0 && <span className={classes.bonusLine}>{byes.join(" · ")}</span>}
          </div>
        );
      })}
    </Stack>
  );
}
