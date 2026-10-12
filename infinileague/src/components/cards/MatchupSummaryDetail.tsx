import type { ReactNode } from "react";
import { X } from "lucide-react";
import { positionColorOrDefault } from "@shared/positionColors";
import type { StandingsRow } from "../../types/season";
import {
  formatPoints,
  formatProj,
  pillStyle,
  positionBadge,
  rankPillStyle,
  type GlassMatchupCardData,
} from "./cardShared";
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

// Every starter whose game hasn't kicked off yet, highest projection first
// - the section shows the first TOP_COUNT and counts the rest.
function upcoming(starters: GlassMatchupCardData[]): GlassMatchupCardData[] {
  return starters
    .filter((card) => card.gameState === "pre")
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0));
}

// Points per game played - null before any game has been played.
function perGame(standing: StandingsRow, points: number): number | null {
  const games = standing.wins + standing.losses + standing.ties;
  return games > 0 ? points / games : null;
}

// Each team's season standing: rank badge and name, then record and points
// per game. Columns as in the player sections below.
function TeamStandings({ teams }: { teams: MatchupDetailTeam[] }) {
  return (
    <div
      className={`${classes.statPanel} ${detailClasses.columns}`}
      style={{ gridTemplateColumns: `repeat(${teams.length}, minmax(0, 1fr))` }}
    >
      {teams.map((team, index) => {
        const standing = team.standing;
        const ppg = standing ? perGame(standing, standing.pointsFor) : null;
        return (
          <div key={index} className={`${detailClasses.column} ${detailClasses.team}`}>
            <div className={detailClasses.teamTitle}>
              {standing && (
                <span
                  className={classes.pill}
                  style={rankPillStyle(standing.isSelf)}
                  aria-label={`Rank ${standing.rank}`}
                >
                  #{standing.rank}
                </span>
              )}
              <span className={detailClasses.teamName}>{team.name}</span>
            </div>
            <div className={`${detailClasses.teamRecord} ${standing ? "" : classes.statEmpty}`}>
              {standing
                ? `${standing.wins}-${standing.losses}-${standing.ties}` +
                  (ppg !== null ? ` · ${ppg.toFixed(1)} PPG` : "")
                : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A player's actual points in the dot-matrix font, as on the Matchup
// tab's player cards (.playerPoints) - live and final scores only; the
// projections and kickoff times around them stay in the plain numerals.
function ScoreboardPoints({ points }: { points: number | undefined }) {
  return (
    <span className={`${classes.playerPoints} ${detailClasses.dotText}`}>
      {formatPoints(points)}
    </span>
  );
}

// One team's column of a player list - the trade summary's row layout:
// position badge spanning both rows, short name over the list's numbers.
function PlayerColumn({
  players,
  detail,
  shortName,
  empty,
  limit,
}: {
  players: GlassMatchupCardData[];
  detail: (card: GlassMatchupCardData) => ReactNode;
  shortName: (fullName: string) => string;
  empty: string;
  // Show at most this many, then a dimmed "+N more" row for the rest.
  limit?: number | undefined;
}) {
  if (players.length === 0) {
    return <div className={`${detailClasses.player} ${classes.statEmpty}`}>{empty}</div>;
  }
  const shown = limit !== undefined ? players.slice(0, limit) : players;
  const hidden = players.length - shown.length;
  return (
    <>
      {shown.map((card) => (
        <div
          key={card.fpid ?? card.name}
          className={`${detailClasses.player} ${detailClasses.playerGrid}`}
        >
          <span
            className={`${classes.pill} ${detailClasses.badge}`}
            style={pillStyle(positionColorOrDefault(card.position))}
          >
            {positionBadge(card)}
          </span>
          <span className={detailClasses.playerNameText}>{shortName(card.name)}</span>
          <div className={`${classes.gameLine} ${detailClasses.playerDetail}`}>
            {detail(card)}
          </div>
        </div>
      ))}
      {hidden > 0 && (
        <div className={`${detailClasses.player} ${detailClasses.playerGrid} ${classes.statEmpty}`}>
          <span className={detailClasses.badgeSpace} />
          <span>+{hidden} more</span>
        </div>
      )}
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
  limit,
}: {
  label: string;
  // Pulsing green dot before the label - the same live dot as the cards'
  // corners and the Live only chip.
  live?: boolean;
  teams: MatchupDetailTeam[];
  pick: (starters: GlassMatchupCardData[]) => GlassMatchupCardData[];
  detail: (card: GlassMatchupCardData) => ReactNode;
  shortName: (fullName: string) => string;
  empty: string;
  limit?: number;
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
              limit={limit}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// The Matchups page's long-press detail (routes/matchups.tsx): both teams'
// standing in the league, then (while any of their games are on) every
// starter playing right now, this week's top performers, and the players
// still to play on each side (top 3 by projection, then a count). `teams`
// is one team on a bye week (no opponent), otherwise [yours, opponent's] -
// same sides as the header.
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

      <div className={classes.statGroups}>
        <TeamStandings teams={teams} />
        {teams.some((team) => liveNow(team.starters).length > 0) && (
          <PlayerSection
            label="Live now"
            live
            teams={teams}
            pick={liveNow}
            detail={(card) => (
              <>
                <span className={classes.gameLineText}>
                  <ScoreboardPoints points={card.actualPoints} />
                </span>
                {card.status && (
                  <span className={`${classes.liveClock} ${detailClasses.dotText}`}>
                    {card.status}
                  </span>
                )}
              </>
            )}
            shortName={shortName}
            empty="None playing"
          />
        )}
        <PlayerSection
          label="Top performers"
          teams={teams}
          pick={topPerformers}
          detail={(card) => (
            <span className={classes.gameLineText}>
              <ScoreboardPoints points={card.actualPoints} />
            </span>
          )}
          shortName={shortName}
          empty="None yet"
        />
        <PlayerSection
          label="Upcoming"
          teams={teams}
          pick={upcoming}
          limit={TOP_COUNT}
          detail={(card) => (
            <span className={classes.gameLineText}>
              {[`Proj ${formatProj(card.projectedPoints)}`, card.status].filter(Boolean).join(" · ")}
            </span>
          )}
          shortName={shortName}
          empty="All games started"
        />
      </div>
    </>
  );
}
