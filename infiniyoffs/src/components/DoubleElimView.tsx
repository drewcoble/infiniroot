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
import type { GroupTeam } from "./GroupCard";
import classes from "./GroupCard.module.css";

function Logo({ teamId, name, size }: { teamId: string; name: string; size: number }) {
  return <TeamLogo name={name} logoUrl={useTeamLogoUrl(teamId)} size={size} />;
}

// A double elimination: the champion, then the winners and losers
// brackets, each swipeable round to round like the Knockout's and running
// on into the Royal Rumble (and, for the winners, the final).
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

      {(["winners", "losers"] as const).map((side) => (
        <Stack key={side} gap="sm">
          <span className={classes.title}>
            {side === "winners" ? "Winners bracket" : "Losers bracket"}
          </span>
          <TournamentBracket
            tournament={brackets[side]}
            teams={teams}
            currentWeek={currentWeek}
            extraColumns={side === "winners" ? brackets.winnersExtra : brackets.losersExtra}
          />
        </Stack>
      ))}
    </Stack>
  );
}
