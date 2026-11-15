import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { rankPillStyle } from "@shared/glass/pills";
import { GlassPopover } from "@shared/glass/GlassPopover";
import { StatGroups, type StatGroup } from "@shared/glass/StatGroups";
import { TeamLogo } from "@shared/glass/TeamLogo";
import { useTeamLogoUrl } from "@shared/glass/teamLogos";
import { useExpandableCard } from "@shared/glass/useExpandableCard";
import classes from "@shared/glass/GlassMatchupCard.module.css";

export interface TeamRowData {
  teamId: string;
  name: string;
  rank: number;
  isMine: boolean;
  nameBadges?: ReactNode;
  primary?: string;
  secondaryLeft?: ReactNode;
  secondaryRight?: ReactNode;
  // Spoken in place of the visible second row.
  summary?: string | undefined;
  stats: StatGroup[];
}

// infinileague's glass team card (GlassTeamCard) without the team-page
// link - long-press (or Space/Enter) opens the details.
export function TeamRow({ data }: { data: TeamRowData }) {
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard(
    [`Rank ${data.rank}`, `${data.name}${data.isMine ? " (you)" : ""}`, data.primary, data.summary]
      .filter(Boolean)
      .join(", "),
  );
  const titleId = useId();
  const logoUrl = useTeamLogoUrl(data.teamId);

  return (
    <div className={classes.rosterRow}>
      <span
        className={`${classes.pill} ${classes.slotChip} ${classes.rankChip}`}
        style={rankPillStyle(data.isMine)}
        aria-hidden
      >
        {data.rank}
      </span>
      <div
        {...cardProps}
        className={[
          classes.card,
          classes.wide,
          classes.teamCard,
          classes.pressable,
          pressing && classes.pressing,
          expanded && classes.hidden,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <TeamLogo name={data.name} logoUrl={logoUrl} size={40} className={classes.teamCardLogo} />
        <div className={`${classes.wideName} ${classes.teamCardName}`} aria-hidden>
          <span className={classes.name}>{data.name}</span>
          {data.nameBadges}
        </div>
        {data.primary !== undefined && (
          <div className={`${classes.widePoints} ${classes.points}`} aria-hidden>
            {data.primary}
          </div>
        )}
        {data.secondaryLeft !== undefined && (
          <div className={`${classes.wideDetail} ${classes.teamCardSecondary}`} aria-hidden>
            {data.secondaryLeft}
          </div>
        )}
        {data.secondaryRight !== undefined && (
          <div className={classes.wideProj} aria-hidden>
            {data.secondaryRight}
          </div>
        )}
      </div>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <div className={classes.teamCardPopoverTitle}>
              <span className={classes.pill} style={rankPillStyle(data.isMine)}>
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
          {data.stats.length > 0 && <StatGroups groups={data.stats} />}
        </GlassPopover>
      )}
    </div>
  );
}
