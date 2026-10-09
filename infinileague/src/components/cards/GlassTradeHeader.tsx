import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import classes from "./GlassMatchupCard.module.css";

// Where this team lands in the league's power rankings if the trade goes
// through (see trade.tsx's getPowerRankingsWithTrade call).
export interface TradeImpactSide {
  beforeRank: number | undefined;
  afterRank: number;
  // Rest-of-season optimal-lineup points, after minus before - in total,
  // and per remaining week (the power rankings' ROS PPG).
  pointsDiff: number | undefined;
  ppgDiff: number | undefined;
}

export interface TradeHeaderTeam {
  name: string;
  // Players this team gives up, and their combined rest-of-season value in
  // `valueLabel`'s units ("ROS VOR" / "ROS PPG").
  sendCount: number;
  sendValue: number;
  valueLabel: string;
  // Combined rest-of-season VOR of the players sent, whatever the switch
  // shows - one half of the winner bar (see tradeBalanceA).
  sendVor: number;
  // undefined = no impact to show yet (a side has nothing selected);
  // "loading" = being computed.
  impact: TradeImpactSide | "loading" | undefined;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function impactText(team: TradeHeaderTeam): string {
  if (team.impact === undefined || team.impact === "loading") return "";
  const { beforeRank, afterRank, pointsDiff } = team.impact;
  const rank =
    beforeRank === undefined || beforeRank === afterRank
      ? `stays power rank ${afterRank}`
      : `power rank ${beforeRank} to ${afterRank}`;
  return pointsDiff !== undefined ? `${rank}, ${signed(pointsDiff)} points` : rank;
}

function Impact({ impact }: { impact: TradeHeaderTeam["impact"] }) {
  if (impact === undefined) return <div className={classes.headerProj} />;
  if (impact === "loading") {
    return <span className={classes.skeletonBar} style={{ width: "58%", height: 12 }} />;
  }
  const { beforeRank, afterRank, pointsDiff } = impact;
  const move = beforeRank !== undefined ? beforeRank - afterRank : 0;
  return (
    <div className={`${classes.headerProj} ${classes.tradeHeaderImpact}`}>
      <span className={classes.headerCount}>
        {move !== 0 && beforeRank !== undefined && <>#{beforeRank} → </>}#{afterRank}
        {move > 0 && <ArrowUp size={12} strokeWidth={3} className={classes.impactUp} />}
        {move < 0 && <ArrowDown size={12} strokeWidth={3} className={classes.impactDown} />}
      </span>
      {pointsDiff !== undefined && (
        <span
          className={
            pointsDiff > 0 ? classes.impactUp : pointsDiff < 0 ? classes.impactDown : undefined
          }
        >
          {signed(pointsDiff)} pts
        </span>
      )}
    </div>
  );
}

function TeamSide({
  team,
  align,
  name,
}: {
  team: TradeHeaderTeam;
  align: "left" | "right";
  // Replaces the plain name - the partner picker, on the right.
  name?: ReactNode;
}) {
  return (
    <div className={`${classes.headerTeam} ${align === "right" ? classes.headerTeamRight : ""}`}>
      {name ?? (
        <div className={classes.headerTeamName} aria-hidden>
          {team.name}
        </div>
      )}
      <div className={classes.headerTotal} aria-hidden>
        {team.sendCount > 0 ? team.sendValue.toFixed(1) : "—"}
      </div>
      <div className={classes.tradeHeaderSends} aria-hidden>
        {team.sendCount > 0
          ? `Sends ${team.sendCount} · ${team.valueLabel}`
          : "Tap players to send"}
      </div>
      <div aria-hidden>
        <Impact impact={team.impact} />
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

// "Who's winning" split - each side's segment is how much it's LOSING the
// trade, so the loser's segment is the bigger, red one and the winner's
// the smaller, green one. Blends two reads, half each (BALANCE_WEIGHTS):
// - VOR: each side's share of the rest-of-season VOR changing hands,
//   counting what it sends (negative VOR - a below-replacement player -
//   counts as nothing rather than flipping the split).
// - Lineup: the power rankings' read - how each team's rest-of-season
//   optimal-lineup PPG changes. The side whose lineup gains less is losing
//   that half, on a logistic curve over the gap (LINEUP_PPG_SCALE: a 1 PPG
//   gap reads ~73/27, 2 PPG ~88/12).
// Until the power-rankings impact comes back, the split is VOR alone, held
// dimmed. A split within FAIR_MARGIN points of 50/50 has no winner: both
// segments go neutral gray and the bar's fixed "Fair" zone (the same
// 46-54% band, drawn over the middle of the bar) lights up.
const BALANCE_WEIGHTS = { vor: 0.5, lineup: 0.5 };
const LINEUP_PPG_SCALE = 1;
const FAIR_MARGIN = 4;
const WINNING_TINT = "#4ade80";
const LOSING_TINT = "#f87171";
const FAIR_TINT = "#9ca3af";

function ppgDiffOf(team: TradeHeaderTeam): number | undefined {
  return team.impact !== undefined && team.impact !== "loading" ? team.impact.ppgDiff : undefined;
}

// Team A's losing share (0-1), and whether the lineup half is in yet.
function tradeBalanceA(
  teamA: TradeHeaderTeam,
  teamB: TradeHeaderTeam,
): { shareA: number; complete: boolean } {
  const sentA = Math.max(teamA.sendVor, 0);
  const sentB = Math.max(teamB.sendVor, 0);
  const vorShareA = sentA + sentB > 0 ? sentA / (sentA + sentB) : 0.5;
  const gainA = ppgDiffOf(teamA);
  const gainB = ppgDiffOf(teamB);
  if (gainA === undefined || gainB === undefined) return { shareA: vorShareA, complete: false };
  const lineupShareA = 1 / (1 + Math.exp((gainA - gainB) / LINEUP_PPG_SCALE));
  return {
    shareA: BALANCE_WEIGHTS.vor * vorShareA + BALANCE_WEIGHTS.lineup * lineupShareA,
    complete: true,
  };
}

function isFair(pct: number): boolean {
  return Math.abs(pct - 50) <= FAIR_MARGIN;
}

function segmentTint(pct: number): string {
  if (isFair(pct)) return FAIR_TINT;
  return pct > 50 ? LOSING_TINT : WINNING_TINT;
}

// The Matchup header's win bar - two segments split at the trade's
// balance point - with the "Fair" zone as a fixed overlay on the bar's
// middle: it stays put while the split moves, and highlights when the
// split lands inside it. `pctA` null = not both sides have picked players
// yet - held at a dimmed 50/50; `pending` = VOR-only while the lineup half
// is still being computed, dimmed.
function TradeBalanceBar({ pctA, pending }: { pctA: number | null; pending: boolean }) {
  const a = pctA ?? 50;
  const b = 100 - a;
  const fair = pctA !== null && !pending && isFair(a);
  return (
    <div
      className={`${classes.winRow} ${classes.tradeBalanceRow} ${pctA === null || pending ? classes.headerPending : ""}`}
      aria-hidden
    >
      <span>{pctA === null ? "–" : `${a}%`}</span>
      <div className={`${classes.winBar} ${classes.tradeBalanceBar}`}>
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
        >
          <span className={classes.fairLabel}>Fair</span>
        </div>
      </div>
      <span>{pctA === null ? "–" : `${b}%`}</span>
    </div>
  );
}

// `name` = the side with the smaller (winning) share.
function balanceText(name: string, pctA: number): string {
  if (isFair(pctA)) return `fair trade, ${pctA}% to ${100 - pctA}%`;
  return `${name} wins the trade, ${Math.min(pctA, 100 - pctA)}% to ${Math.max(pctA, 100 - pctA)}%`;
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

// Trade tab's header in the Matchup header's glass and two-column layout:
// each side's team name, the rest-of-season value it sends (the big number -
// VOR or PPG, following the page's switch), how many players that is, and -
// once both sides have picked players - where the trade leaves the team in
// the power rankings. The right side's name is the trade-partner picker;
// `teamB` null = no partner picked yet (the rest of that side dimmed, like
// the Matchup header's missing opponent).
export function GlassTradeHeader({
  teamA,
  teamB,
  partnerOptions,
  partnerId,
  onPartnerChange,
}: {
  teamA: TradeHeaderTeam | "loading";
  teamB: TradeHeaderTeam | "loading" | null;
  partnerOptions: TradePartnerOption[];
  partnerId: string | null;
  onPartnerChange: (teamId: string | null) => void;
}) {
  const teamText = (team: TradeHeaderTeam) =>
    [
      team.name,
      team.sendCount > 0
        ? `sends ${team.sendCount} players, ${team.sendValue.toFixed(1)} ${team.valueLabel}`
        : "no players selected",
      impactText(team),
    ]
      .filter(Boolean)
      .join(", ");
  const bothLoaded = teamA !== "loading" && teamB !== "loading" && teamB !== null;
  const balance =
    bothLoaded && teamA.sendCount > 0 && teamB.sendCount > 0 ? tradeBalanceA(teamA, teamB) : null;
  const pctA = balance !== null ? Math.round(balance.shareA * 100) : null;
  const balancePending = balance !== null && !balance.complete;
  const ariaLabel =
    teamA === "loading"
      ? "Loading trade"
      : teamB === "loading" || teamB === null
        ? teamText(teamA)
        : `${teamText(teamA)}; ${teamText(teamB)}` +
          (pctA !== null && !balancePending
            ? `; ${balanceText(pctA <= 50 ? teamA.name : teamB.name, pctA)}`
            : "");
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
      <div className={`${classes.headerTeams} ${classes.tradeHeaderTeams}`}>
        {teamA === "loading" ? (
          <TeamSideSkeleton align="left" />
        ) : (
          <TeamSide team={teamA} align="left" />
        )}
        {teamB === "loading" ? (
          <TeamSideSkeleton align="right" name={picker} />
        ) : teamB ? (
          <TeamSide team={teamB} align="right" name={picker} />
        ) : (
          <div className={`${classes.headerTeam} ${classes.headerTeamRight}`}>
            {picker}
            <div className={`${classes.headerTotal} ${classes.headerPending}`} aria-hidden>
              —
            </div>
            <div className={`${classes.tradeHeaderSends} ${classes.headerPending}`} aria-hidden>
              Trade partner
            </div>
            <span />
          </div>
        )}
      </div>
      {teamB !== null && <TradeBalanceBar pctA={pctA} pending={balancePending} />}
    </div>
  );
}
