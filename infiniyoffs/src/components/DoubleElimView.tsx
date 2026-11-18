import { Stack } from "@mantine/core";
import { Trophy } from "lucide-react";
import type { StageResult } from "@playoffRules/evaluate";
import type { DoubleElimStage } from "@playoffRules/format";
import { TeamLogo } from "@shared/glass/TeamLogo";
import { useTeamLogoUrl } from "@shared/glass/teamLogos";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import bracketClasses from "@shared/glass/TournamentBracket.module.css";
import { TournamentBracket, type BracketTeam } from "@shared/glass/TournamentBracket";
import { doubleElimBrackets } from "../lib/bracketView";
import { GameLine, type GroupTeam } from "./GroupCard";
import classes from "./GroupCard.module.css";

function Logo({ teamId, name, size }: { teamId: string; name: string; size: number }) {
  return <TeamLogo name={name} logoUrl={useTeamLogoUrl(teamId)} size={size} />;
}

// A double elimination: the champion, the final (if a once-beaten team
// forces one) and the Royal Rumble's standings, then the winners and
// losers brackets, each swipeable round to round like the Knockout's.
export function DoubleElimView({
  stage,
  result,
  teams,
  currentWeek,
}: {
  stage: DoubleElimStage;
  result: StageResult;
  teams: ReadonlyMap<string, GroupTeam & BracketTeam>;
  currentWeek: number;
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
  const brackets = doubleElimBrackets(stage, result);

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
          Royal Rumble week {stage.rumbleWeek} · field set after week{" "}
          {stage.weeks[stage.weeks.length - 1]}
        </div>
      )}

      {(["winners", "losers"] as const).map((side) => (
        <Stack key={side} gap="sm">
          <span className={classes.title}>
            {side === "winners" ? "Winners bracket" : "Losers bracket"}
          </span>
          <TournamentBracket
            tournament={brackets[side]}
            teams={teams}
            currentWeek={currentWeek}
          />
        </Stack>
      ))}
    </Stack>
  );
}
