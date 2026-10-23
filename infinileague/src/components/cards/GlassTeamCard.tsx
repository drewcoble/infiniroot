import { useId, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, X } from "lucide-react";
import type { TeamPositionRanks } from "../../types/season";
import { TeamPositionRanksPanel } from "../TeamPositionRanksPanel";
import { rankPillStyle } from "./cardShared";
import { GlassPopover } from "./GlassPopover";
import { StatGroups, type StatGroup } from "./StatGroups";
import { TeamLogo } from "./TeamLogo";
import { useTeamLogoUrl } from "./teamLogos";
import { useExpandableCard } from "./useExpandableCard";
import classes from "./GlassMatchupCard.module.css";

export interface GlassTeamCardData {
  leagueId: string;
  teamId: string;
  name: string;
  rank: number;
  isSelf: boolean;
  // Small badges after the name - power rankings' week-over-week move,
  // elimination watch's status.
  nameBadges?: ReactNode;
  // The list's headline number (record, week points) on the name's row -
  // optional, for lists whose number reads better under the name - and an
  // optional second-row left/right line.
  primary?: string;
  secondaryLeft?: ReactNode;
  secondaryRight?: ReactNode;
  // Spoken summary of the second row for screen readers (the visible rows
  // are hidden from them in favor of one label).
  summary?: string | undefined;
  // Labeled tiles for the detail popover.
  // Grouped numbers for the detail popover (see StatGroups).
  stats: StatGroup[];
}

// League-home team card (Standings / Power Rankings / Elimination Watch) in
// the full-width glass card's layout: the team's logo (TeamLogo - from the
// league layout's standings, by teamId), name and the list's headline number
// on the first row, a supporting line under each, and a chevron - the whole
// card is a link to the team page. Long-press (or Space) opens the team's
// detail popover instead - its stats and the position-strength radar that
// used to expand inline.
export function GlassTeamCard({
  data,
  positionRanks,
  totalTeams,
}: {
  data: GlassTeamCardData;
  // undefined = still loading (skeleton); null = this list doesn't fetch
  // them (the Trade tab's post-trade rankings) - no position-strength
  // section at all.
  positionRanks: TeamPositionRanks | undefined | null;
  totalTeams: number;
}) {
  const { cardProps, anchor, expanded, pressing, close } = useExpandableCard<HTMLAnchorElement>(
    [`Rank ${data.rank}`, `${data.name}${data.isSelf ? " (you)" : ""}`, data.primary, data.summary]
      .filter(Boolean)
      .join(", "),
    { asLink: true },
  );
  const titleId = useId();
  const logoUrl = useTeamLogoUrl(data.teamId);

  return (
    <div className={classes.rosterRow}>
      <span
        className={`${classes.pill} ${classes.slotChip} ${classes.rankChip}`}
        style={rankPillStyle(data.isSelf)}
        aria-hidden
      >
        {data.rank}
      </span>
      <Link
        to="/league/$leagueId/teams/$teamId"
        params={{ leagueId: data.leagueId, teamId: data.teamId }}
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
        <TeamLogo
          name={data.name}
          logoUrl={logoUrl}
          size={40}
          className={classes.teamCardLogo}
        />
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
        <ChevronRight className={classes.teamCardChevron} size={18} strokeWidth={2.5} aria-hidden />
      </Link>

      {anchor && (
        <GlassPopover anchor={anchor} onClose={close} labelledBy={titleId}>
          <div className={classes.expandedHeader}>
            <div className={classes.teamCardPopoverTitle}>
              <span
                className={classes.pill}
                style={rankPillStyle(data.isSelf)}
              >
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

          {data.stats.length > 0 && (
            <StatGroups groups={data.stats} />
          )}

          {positionRanks !== null && (
            <TeamPositionRanksPanel positionRanks={positionRanks} totalTeams={totalTeams} />
          )}
        </GlassPopover>
      )}
    </div>
  );
}
