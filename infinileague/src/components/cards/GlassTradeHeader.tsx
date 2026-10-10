import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { formatTradeValue } from "../../lib/tradeValue";
import classes from "./GlassMatchupCard.module.css";

export interface TradeHeaderTeam {
  name: string;
  // Players this team gives up.
  sendCount: number;
  // Their combined avg value (lib/tradeValue.ts), consolidation credit
  // included so the two sides' numbers and the verdict's margin agree -
  // undefined while the values load.
  value: number | undefined;
  // The consolidation credit inside `value`, if any - named on this side's
  // small line so the number still reads as more than its players' sum.
  credit: number;
}

function sideLine(team: TradeHeaderTeam): string {
  if (team.sendCount === 0) return "Tap players to send";
  const players = `${team.sendCount} player${team.sendCount === 1 ? "" : "s"}`;
  return team.credit > 0 ? `${players} · +${formatTradeValue(team.credit)} 2-for-1` : players;
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
      <div className={`${classes.headerTotal} ${classes.tradeHeaderTotal}`} aria-hidden>
        {team.sendCount === 0 ? "—" : team.value !== undefined ? formatTradeValue(team.value) : "…"}
      </div>
      <div className={classes.tradeHeaderSends} aria-hidden>
        {sideLine(team)}
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

// Trade tab's summary, kept to what decides a trade: each side's team name,
// the avg value it sends (one number, consolidation credit included), how
// many players that is, then a one-line verdict ("X wins by 238" / "Fair
// trade") over the value bar. Always in avg value, whatever the cards'
// switch shows. The right side's name is the trade-partner picker; `teamB`
// null = no partner picked yet. The power-rankings impact lives in the
// post-trade rankings below (or the peek card on mobile), not here.
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
  const sides =
    teamA !== "loading" &&
    teamB !== "loading" &&
    teamB !== null &&
    teamA.sendCount > 0 &&
    teamB.sendCount > 0 &&
    teamA.value !== undefined &&
    teamB.value !== undefined
      ? { a: teamA, b: teamB, valueA: teamA.value, valueB: teamB.value }
      : null;
  const pctA = sides
    ? Math.round((sides.valueA / Math.max(sides.valueA + sides.valueB, 1)) * 100)
    : null;
  const verdictText = sides && pctA !== null ? verdict(sides.a, sides.b, pctA) : null;
  const teamText = (team: TradeHeaderTeam) =>
    team.sendCount > 0 && team.value !== undefined
      ? `${team.name} sends ${sideLine(team)}, ${formatTradeValue(team.value)} value`
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
      <div className={classes.headerTeams}>
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
            <div
              className={`${classes.headerTotal} ${classes.tradeHeaderTotal} ${classes.headerPending}`}
              aria-hidden
            >
              —
            </div>
            <div className={`${classes.tradeHeaderSends} ${classes.headerPending}`} aria-hidden>
              Trade partner
            </div>
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
