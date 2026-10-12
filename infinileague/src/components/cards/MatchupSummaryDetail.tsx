import { X } from "lucide-react";
import { positionColorOrDefault } from "@shared/positionColors";
import type { StandingsRow } from "../../types/season";
import { formatProj, pillStyle, positionBadge, type GlassMatchupCardData } from "./cardShared";
import { StatGroups, type StatGroup } from "./StatGroups";
import classes from "./GlassMatchupCard.module.css";
import detailClasses from "./MatchupSummaryDetail.module.css";

export interface MatchupDetailTeam {
  name: string;
  // undefined while standings load (or the team isn't in them).
  standing: StandingsRow | undefined;
  // This week's starters as card data (lib/matchupCardData.ts) - empty
  // while the roster loads.
  starters: GlassMatchupCardData[];
}

// How many players each list shows per team.
const TOP_COUNT = 3;

// Every starter whose game is underway right now, most points first.
function liveNow(starters: GlassMatchupCardData[]): GlassMatchupCardData[] {
  return starters
    .filter((card) => card.gameState === "live")
    .sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0));
}

// Starters with the most points this week, among those who've already met
// or beaten their projection - the players carrying the week so far.
function topPerformers(starters: GlassMatchupCardData[]): GlassMatchupCardData[] {
  return starters
    .filter(
      (card) =>
        card.actualPoints !== undefined &&
        card.actualPoints > 0 &&
        card.actualPoints >= (card.projectedPoints ?? 0),
    )
    .sort((a, b) => (b.actualPoints ?? 0) - (a.actualPoints ?? 0))
    .slice(0, TOP_COUNT);
}

// Starters whose games haven't kicked off yet, highest projection first.
function topUpcoming(starters: GlassMatchupCardData[]): GlassMatchupCardData[] {
  return starters
    .filter((card) => card.gameState === "pre")
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0))
    .slice(0, TOP_COUNT);
}

function seasonPpg(standing: StandingsRow, points: number): string {
  const games = standing.wins + standing.losses + standing.ties;
  return games > 0 ? (points / games).toFixed(1) : "—";
}

function teamStats(teams: MatchupDetailTeam[]): StatGroup {
  const value = (team: MatchupDetailTeam, read: (standing: StandingsRow) => string) =>
    team.standing ? read(team.standing) : "—";
  return {
    columns: teams.map((team) => team.name),
    rows: [
      { label: "Rank", values: teams.map((team) => value(team, (s) => `#${s.rank}`)) },
      {
        label: "Record",
        values: teams.map((team) => value(team, (s) => `${s.wins}-${s.losses}-${s.ties}`)),
      },
      { label: "PPG", values: teams.map((team) => value(team, (s) => seasonPpg(s, s.pointsFor))) },
      {
        label: "Opp PPG",
        values: teams.map((team) => value(team, (s) => seasonPpg(s, s.pointsAgainst))),
      },
    ],
  };
}

// One team's column of a player list - position badge and short name, with
// the list's numbers underneath.
function PlayerColumn({
  players,
  detail,
  shortName,
  empty,
}: {
  players: GlassMatchupCardData[];
  detail: (card: GlassMatchupCardData) => string;
  shortName: (fullName: string) => string;
  empty: string;
}) {
  if (players.length === 0) {
    return <div className={`${detailClasses.player} ${classes.statEmpty}`}>{empty}</div>;
  }
  return (
    <>
      {players.map((card) => (
        <div key={card.fpid ?? card.name} className={detailClasses.player}>
          <div className={detailClasses.playerName}>
            <span className={classes.pill} style={pillStyle(positionColorOrDefault(card.position))}>
              {positionBadge(card)}
            </span>
            <span className={detailClasses.playerNameText}>{shortName(card.name)}</span>
          </div>
          <div className={`${classes.gameLine} ${detailClasses.playerDetail}`}>
            <span className={classes.gameLineText}>{detail(card)}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function PlayerSection({
  label,
  live = false,
  teams,
  pick,
  detail,
  shortName,
  empty,
}: {
  label: string;
  // Pulsing green dot before the label - the same live dot as the cards'
  // corners and the Live only chip.
  live?: boolean;
  teams: MatchupDetailTeam[];
  pick: (starters: GlassMatchupCardData[]) => GlassMatchupCardData[];
  detail: (card: GlassMatchupCardData) => string;
  shortName: (fullName: string) => string;
  empty: string;
}) {
  return (
    <section aria-label={label}>
      <div className={classes.statGroupLabel}>
        {live && <span className={classes.dot} style={{ verticalAlign: 0 }} aria-hidden />}
        {label}
      </div>
      <div
        className={`${classes.statPanel} ${detailClasses.columns}`}
        style={{ gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` }}
      >
        {teams.map((team, index) => (
          <div key={index} className={detailClasses.column} aria-label={team.name}>
            <PlayerColumn
              players={pick(team.starters)}
              detail={detail}
              shortName={shortName}
              empty={empty}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// The Matchups page's long-press detail (routes/matchups.tsx): both teams'
// standing in the league, then (while any of their games are on) every
// starter playing right now, this week's top performers and the best
// players still to play on each side. `teams` is one team on a bye week
// (no opponent), otherwise [yours, opponent's] - same sides as the header.
export function MatchupSummaryDetail({
  title,
  titleId,
  subtitle,
  teams,
  shortName,
  onClose,
}: {
  title: string;
  titleId: string;
  subtitle: string;
  teams: MatchupDetailTeam[];
  shortName: (fullName: string) => string;
  onClose: () => void;
}) {
  return (
    <>
      <div className={classes.expandedHeader}>
        <div style={{ minWidth: 0 }}>
          <div id={titleId} className={classes.expandedName}>
            {title}
          </div>
          <div className={classes.gameLine}>
            <span className={classes.gameLineText}>{subtitle}</span>
          </div>
        </div>
        <button type="button" className={classes.closeButton} onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={2.5} />
        </button>
      </div>

      <div className={`${classes.statGroups} ${detailClasses.teamTable}`}>
        <StatGroups groups={[teamStats(teams)]} />
        {teams.some((team) => liveNow(team.starters).length > 0) && (
          <PlayerSection
            label="Live now"
            live
            teams={teams}
            pick={liveNow}
            detail={(card) =>
              [`${formatProj(card.actualPoints)} pts`, card.status].filter(Boolean).join(" · ")
            }
            shortName={shortName}
            empty="None playing"
          />
        )}
        <PlayerSection
          label="Top performers"
          teams={teams}
          pick={topPerformers}
          detail={(card) =>
            `${formatProj(card.actualPoints)} pts · proj ${formatProj(card.projectedPoints)}`
          }
          shortName={shortName}
          empty="None yet"
        />
        <PlayerSection
          label="Top upcoming"
          teams={teams}
          pick={topUpcoming}
          detail={(card) =>
            [`Proj ${formatProj(card.projectedPoints)}`, card.status].filter(Boolean).join(" · ")
          }
          shortName={shortName}
          empty="All games started"
        />
      </div>
    </>
  );
}
