import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { formatTradeValue } from "../../lib/tradeValue";
import { pillStyle } from "./cardShared";
import type { TradeMetric } from "./GlassTradeCard";
import { PlayerHeadshot } from "./PlayerHeadshot";
import { TeamLogo } from "./TeamLogo";
import { useTeamLogoUrl } from "./teamLogos";
import classes from "./GlassMatchupCard.module.css";

// One player a side sends, with every view's numbers - the header shows
// whichever the switch picks.
export interface TradeHeaderPlayer {
  fpid: number;
  // NFL team - DST's headshot is its team logo (PlayerHeadshot).
  team: string | null;
  // Short name (lib/shortPlayerName.ts), as on the cards.
  name: string;
  position: Position;
  // Avg value - undefined while the values load.
  value: number | undefined;
  actualPpg: string;
  rosPpg: string;
  // Position ranks ("WR12"), season to date and rest of season.
  actualRank: string;
  rosRank: string;
}

export interface TradeHeaderTeam {
  // For the team's logo (teamLogos.ts's useTeamLogoUrl).
  teamId: string;
  name: string;
  // Players this team gives up.
  players: TradeHeaderPlayer[];
  // Their combined avg value (lib/tradeValue.ts), consolidation credit
  // included so the two sides' numbers and the verdict's margin agree -
  // undefined while the values load.
  value: number | undefined;
  // The consolidation credit inside `value`, if any - its own row under
  // the Value view's players, so the list still adds up to the total.
  credit: number;
  // Summed per-game rates of the players sent, for the PPG view.
  rosPpgTotal: number;
  actualPpgTotal: number;
}

// The big number and the line under it, per view - Ranks has neither
// (ranks don't add up).
function sideTotals(
  team: TradeHeaderTeam,
  metric: TradeMetric,
): { big: string; line: string } | null {
  if (metric === "rank") return null;
  if (team.players.length === 0) return { big: "—", line: "" };
  if (metric === "ppg") {
    return {
      big: team.rosPpgTotal.toFixed(1),
      line: `ROS PPG · ${team.actualPpgTotal.toFixed(1)} actual`,
    };
  }
  // No line in the Value view - the 2-for-1 adjustment is its own row in
  // the player list instead.
  return { big: team.value !== undefined ? formatTradeValue(team.value) : "…", line: "" };
}

// Each player sent, two rows: a small position badge and the name, then
// the view's numbers under it - value; or actual and ROS PPG / position
// rank, each with a short label. The Value view's 2-for-1 adjustment, when
// there is one, is the last entry so the list adds up to the total.
function PlayerList({ team, metric }: { team: TradeHeaderTeam; metric: TradeMetric }) {
  if (team.players.length === 0) {
    return <div className={classes.tradeHeaderSends}>Tap players to send</div>;
  }
  const numbers = (player: TradeHeaderPlayer) =>
    metric === "value" ? (
      <span>{player.value !== undefined ? formatTradeValue(player.value) : "…"}</span>
    ) : (
      <>
        <span>
          <span className={classes.tradeHeaderLabel}>Act</span>
          {metric === "ppg" ? player.actualPpg : player.actualRank}
        </span>
        <span>
          <span className={classes.tradeHeaderLabel}>ROS</span>
          {metric === "ppg" ? player.rosPpg : player.rosRank}
        </span>
      </>
    );
  return (
    <div className={classes.tradeHeaderPlayers}>
      {team.players.map((player) => (
        <div key={player.fpid} className={classes.tradeHeaderEntry}>
          <PlayerHeadshot
            fpid={player.fpid}
            position={player.position}
            team={player.team}
            className={classes.tradeHeaderHeadshot}
          />
          <span
            className={`${classes.pill} ${classes.tradeHeaderBadge}`}
            style={pillStyle(positionColorOrDefault(player.position))}
          >
            {player.position}
          </span>
          <span className={classes.tradeHeaderPlayerName}>{player.name}</span>
          <div className={classes.tradeHeaderNumbers}>{numbers(player)}</div>
        </div>
      ))}
      {metric === "value" && team.credit > 0 && (
        <div className={classes.tradeHeaderEntry}>
          <span className={classes.tradeHeaderHeadshotSpace} />
          <span className={classes.tradeHeaderBadgeSpace} />
          <span className={classes.tradeHeaderPlayerName}>2-for-1 adj.</span>
          <div className={classes.tradeHeaderNumbers}>
            <span>+{formatTradeValue(team.credit)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamSide({
  team,
  metric,
  align,
  name,
}: {
  team: TradeHeaderTeam;
  metric: TradeMetric;
  align: "left" | "right";
  // Replaces the plain name - the partner picker, on the right.
  name?: ReactNode;
}) {
  const summary = sideTotals(team, metric);
  const logoUrl = useTeamLogoUrl(team.teamId);
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      {/* Logo and name (or the partner picker) on one line, like the
          Matchup header. */}
      <div className={classes.headerTeamTitle}>
        <TeamLogo name={team.name} logoUrl={logoUrl} size={22} />
        {name ?? (
          <div className={classes.headerTeamName} aria-hidden>
            {team.name}
          </div>
        )}
      </div>
      {summary ? (
        <>
          <div className={`${classes.headerTotal} ${classes.tradeHeaderTotal}`} aria-hidden>
            {summary.big}
          </div>
          <div className={classes.tradeHeaderSends} aria-hidden>
            {summary.line}
          </div>
        </>
      ) : (
        <>
          <span />
          <span />
        </>
      )}
      <div className={classes.tradeHeaderListCell} aria-hidden>
        <PlayerList team={team} metric={metric} />
      </div>
    </div>
  );
}

function TeamSideSkeleton({ align, name }: { align: "left" | "right"; name?: ReactNode }) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      {name ?? <span className={classes.skeletonBar} style={{ width: "70%", height: 14 }} />}
      <span className={classes.skeletonBar} style={{ width: "40%", height: 28, marginTop: 4 }} />
      <span className={classes.skeletonBar} style={{ width: "52%", height: 11, marginTop: 4 }} />
      <span />
    </div>
  );
}

// Who's winning, by value sent: each side's segment is its share of the
// value changing hands, so the side giving up more has the bigger, red
// segment and the side giving up less the smaller, green one. Within
// FAIR_MARGIN points of 50/50 there's no winner - both segments go neutral
// gray and the fixed Fair zone over the bar's middle (46-54%) lights up.
const FAIR_MARGIN = 4;
const WINNING_TINT = "#4ade80";
const LOSING_TINT = "#f87171";
const FAIR_TINT = "#9ca3af";

function isFair(pct: number): boolean {
  return Math.abs(pct - 50) <= FAIR_MARGIN;
}

function segmentTint(pct: number): string {
  if (isFair(pct)) return FAIR_TINT;
  return pct > 50 ? LOSING_TINT : WINNING_TINT;
}

// `pctA` null = nothing to compare yet - held at a dimmed 50/50.
function TradeBalanceBar({ pctA }: { pctA: number | null }) {
  const a = pctA ?? 50;
  const b = 100 - a;
  const fair = pctA !== null && isFair(a);
  return (
    <div
      className={`${classes.winBar} ${classes.tradeBalanceBar} ${pctA === null ? classes.headerPending : ""}`}
      aria-hidden
    >
      <div
        className={classes.winSegment}
        style={{ width: `${a}%`, ["--pill-tint" as string]: segmentTint(a) }}
      />
      <div
        className={classes.winSegment}
        style={{ width: `${b}%`, ["--pill-tint" as string]: segmentTint(b) }}
      />
      <div
        className={`${classes.fairZone} ${fair ? classes.fairZoneActive : ""}`}
        style={{ left: `${50 - FAIR_MARGIN}%`, width: `${FAIR_MARGIN * 2}%` }}
      />
    </div>
  );
}

function verdict(teamA: TradeHeaderTeam, teamB: TradeHeaderTeam, pctA: number): string {
  if (isFair(pctA)) return "Fair trade";
  const valueA = teamA.value ?? 0;
  const valueB = teamB.value ?? 0;
  const winner = valueA < valueB ? teamA : teamB;
  return `${winner.name} wins by ${formatTradeValue(Math.abs(valueA - valueB))}`;
}

export interface TradePartnerOption {
  value: string;
  label: string;
}

// The right side's team name doubles as the trade-partner picker: a native
// select (the phone's own picker wheel/sheet) laid invisibly over the name
// and its chevron, so it reads as the header's title rather than a form
// field.
function PartnerPicker({
  options,
  value,
  onChange,
}: {
  options: TradePartnerOption[];
  value: string | null;
  onChange: (teamId: string | null) => void;
}) {
  const label = options.find((option) => option.value === value)?.label;
  return (
    <div className={`${classes.headerTeamName} ${classes.partnerPicker}`}>
      <span className={classes.partnerPickerText} aria-hidden>
        {label ?? "Pick a team"}
      </span>
      <ChevronDown
        size={14}
        strokeWidth={2.5}
        className={classes.partnerPickerChevron}
        aria-hidden
      />
      <select
        className={classes.partnerPickerSelect}
        aria-label="Trading with"
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value || null)}
      >
        {value === null && (
          <option value="" disabled>
            Pick a team
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Trade tab's summary, following the cards' switch: each side's team name,
// then per view - Value: the avg value total and each player's value,
// with the consolidation credit as its own row so the list adds up; PPG: the
// ROS PPG total (actual under it) and each player's actual | ROS PPG;
// Ranks: no total, each player's actual | ROS position rank. Every view
// ends with the same one-line verdict ("X wins by 238" / "Fair trade") over
// the value bar - fairness is always judged on value. The right side's
// name is the trade-partner picker; `teamB` null = no partner picked yet.
// The power-rankings impact lives in the post-trade rankings below (or the
// peek card on mobile), not here.
export function GlassTradeHeader({
  metric,
  teamA,
  teamB,
  partnerOptions,
  partnerId,
  onPartnerChange,
}: {
  metric: TradeMetric;
  teamA: TradeHeaderTeam | "loading";
  teamB: TradeHeaderTeam | "loading" | null;
  partnerOptions: TradePartnerOption[];
  partnerId: string | null;
  onPartnerChange: (teamId: string | null) => void;
}) {
  const sides =
    teamA !== "loading" &&
    teamB !== "loading" &&
    teamB !== null &&
    teamA.players.length > 0 &&
    teamB.players.length > 0 &&
    teamA.value !== undefined &&
    teamB.value !== undefined
      ? { a: teamA, b: teamB, valueA: teamA.value, valueB: teamB.value }
      : null;
  const pctA = sides
    ? Math.round((sides.valueA / Math.max(sides.valueA + sides.valueB, 1)) * 100)
    : null;
  const verdictText = sides && pctA !== null ? verdict(sides.a, sides.b, pctA) : null;
  const teamText = (team: TradeHeaderTeam) =>
    team.players.length > 0
      ? `${team.name} sends ${team.players.map((player) => player.name).join(", ")}` +
        (team.value !== undefined ? `, ${formatTradeValue(team.value)} value` : "")
      : `${team.name}, no players selected`;
  const ariaLabel =
    teamA === "loading"
      ? "Loading trade"
      : teamB === "loading" || teamB === null
        ? teamText(teamA)
        : `${teamText(teamA)}; ${teamText(teamB)}` + (verdictText ? `; ${verdictText}` : "");
  const picker = (
    <PartnerPicker options={partnerOptions} value={partnerId} onChange={onPartnerChange} />
  );
  return (
    <div
      className={`${classes.card} ${classes.header}`}
      role="group"
      aria-label={ariaLabel}
      aria-busy={teamA === "loading" || teamB === "loading"}
    >
      <div className={`${classes.headerTeams} ${classes.tradeHeaderGrid}`}>
        {teamA === "loading" ? (
          <TeamSideSkeleton align="left" />
        ) : (
          <TeamSide team={teamA} metric={metric} align="left" />
        )}
        {teamB === "loading" ? (
          <TeamSideSkeleton align="right" name={picker} />
        ) : teamB ? (
          <TeamSide team={teamB} metric={metric} align="right" name={picker} />
        ) : (
          <div className={`${classes.headerTeam} ${classes.headerTeamRight}`}>
            {picker}
            <div
              className={`${classes.headerTotal} ${classes.tradeHeaderTotal} ${classes.headerPending}`}
              aria-hidden
            >
              —
            </div>
            <div className={`${classes.tradeHeaderSends} ${classes.headerPending}`} aria-hidden>
              Trade partner
            </div>
            <span />
          </div>
        )}
      </div>
      {teamB !== null && (
        <div className={classes.tradeVerdictBlock}>
          <div
            className={`${classes.tradeVerdictMain} ${verdictText ? "" : classes.headerPending}`}
            aria-hidden
          >
            {verdictText ?? "Pick players on both sides"}
          </div>
          <TradeBalanceBar pctA={pctA} />
        </div>
      )}
    </div>
  );
}
