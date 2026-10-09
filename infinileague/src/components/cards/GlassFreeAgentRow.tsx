import { useId, type CSSProperties } from "react";
import { X } from "lucide-react";
import { injuryColor } from "@shared/injuryColor";
import { positionColorOrDefault, type Position } from "@shared/positionColors";
import { pillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export interface GlassFreeAgentRowData {
  // Place in the list (sorted by suggested bid).
  rank: number;
  name: string;
  position: Position;
  positionRank: number;
  team: string | null;
  isRookie: boolean;
  injury?: { status: string; statusShort: string } | undefined;
  // "$14" - the suggested bid (or the market value without one); "" when
  // nobody's bidding on this player.
  bid: string;
  // "Mkt $9" under it.
  market: string;
  // Why the bid is what it is, and any injury-replacement boost - dimmed on
  // a third line (truncated), in full in the popover.
  rationale: string | null;
  boostReason: string | null;
  // Labeled tiles for the long-press detail popover.
  stats: Array<{ label: string; value: string }>;
}

const RANK_CHIP_STYLE = {
  color: "#f8fafc",
  fontFamily: "var(--font-numeric)",
  "--pill-tint": "var(--mantine-color-gray-5)",
} as CSSProperties;

// One Free Agents row in the Players board's glass layout (see
// GlassPlayerRow): name with injury/rookie badges | suggested bid, then
// position + NFL team | market value, then the bid rationale. Long-press (or
// Enter/Space) opens the full read - bid/market/value/demand tiles and the
// untruncated rationale.
export function GlassFreeAgentRow({ data }: { data: GlassFreeAgentRowData }) {
  const note = [data.boostReason, data.rationale].filter(Boolean).join(" · ");
  const label = [
    `${data.rank}`,
    data.name,
    `${data.position}${data.positionRank > 0 ? ` ${data.positionRank}` : ""}`,
    data.team,
    data.isRookie ? "rookie" : null,
    data.injury?.status,
    data.bid ? `suggested bid ${data.bid}` : null,
    data.market,
    note || null,
  ]
    .filter(Boolean)
    .join(", ");
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(label);
  const titleId = useId();

  return (
    <div className={classes.rosterRow}>
      <span className={`${classes.pill} ${classes.slotChip}`} style={RANK_CHIP_STYLE} aria-hidden>
        {data.rank}
      </span>
      <div
        {...cardProps}
        className={[
          classes.card,
          classes.wide,
          note ? classes.freeAgentRowNoted : classes.playerRow,
          classes.pressable,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={`${classes.wideName} ${classes.teamCardName}`}>
          <span className={classes.name}>{data.name}</span>
          {data.isRookie && (
            <span className={`${classes.pill} ${classes.nameBadge}`} style={pillStyle("grape")}>
              R
            </span>
          )}
          {data.injury && (
            <span
              className={`${classes.pill} ${classes.nameBadge}`}
              style={pillStyle(injuryColor(data.injury.status))}
            >
              {data.injury.statusShort}
            </span>
          )}
        </div>
        <div className={`${classes.widePoints} ${classes.points}`}>{data.bid}</div>
        <div className={classes.wideDetail}>
          <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
            {data.position}
            {data.positionRank > 0 ? data.positionRank : ""}
          </span>
          {data.team && (
            <span className={`${classes.gameLine} ${classes.wideGameLine}`}>
              <span className={classes.gameLineText}>{data.team}</span>
            </span>
          )}
        </div>
        <div className={classes.wideProj}>{data.market}</div>
        {note && (
          <div className={classes.freeAgentNote}>
            <span className={classes.gameLineText}>{note}</span>
          </div>
        )}
      </div>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <div className={classes.teamCardPopoverTitle}>
              <span className={classes.pill} style={RANK_CHIP_STYLE}>
                #{data.rank}
              </span>
              <span id={titleId} className={classes.expandedName}>
                {data.name}
              </span>
            </div>
            <button
              type="button"
              className={classes.closeButton}
              onClick={close}
              aria-label="Close"
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

          <div className={classes.pills}>
            <span className={classes.pill} style={pillStyle(positionColorOrDefault(data.position))}>
              {data.position}
              {data.positionRank > 0 ? data.positionRank : ""}
            </span>
            {data.injury && (
              <span className={classes.pill} style={pillStyle(injuryColor(data.injury.status))}>
                {data.injury.status}
              </span>
            )}
            {data.isRookie && (
              <span className={classes.pill} style={pillStyle("grape")}>
                Rookie
              </span>
            )}
          </div>

          {data.team && (
            <div className={classes.gameLine}>
              <span className={classes.gameLineText}>{data.team} · Free agent</span>
            </div>
          )}

          <div className={classes.statGrid}>
            {data.stats.map((stat) => (
              <div key={stat.label} className={classes.stat}>
                <div className={classes.statValue}>{stat.value}</div>
                <div className={classes.statLabel}>{stat.label}</div>
              </div>
            ))}
          </div>

          {(data.rationale || data.boostReason) && (
            <div className={classes.freeAgentPopoverNotes}>
              {data.boostReason && <p>{data.boostReason}</p>}
              {data.rationale && <p>{data.rationale}</p>}
            </div>
          )}
        </GlassPopover>
      )}
    </div>
  );
}
