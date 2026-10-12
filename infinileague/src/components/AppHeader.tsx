import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@mantine/core";
import { useConvexAuth, useQuery } from "convex/react";
import {
  Check,
  Database,
  GalleryVerticalEnd,
  HeartPulse,
  LayoutGrid,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { glassClasses } from "@shared/glassClasses";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { setStoredLeagueId } from "../lib/leagueStorage";
import { TicketStack } from "./icons/TicketStack";
import type { LinkedSeason } from "../types/season";

// Thin infinileague-specific wrapper around @shared/AppHeader: backed by
// listLinkedSeasons, and its own "Add League" footer item instead of
// infinidraft's "New League" - no draft phase/status, no TV board/report
// card/billing overflow items (none of those concepts exist here). The
// shared header's mode-switch slot holds the Matchups button instead.
export function AppHeader() {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.users.getCurrentUser);
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listLinkedSeasons,
    isAuthenticated ? {} : "skip",
  );

  const selectedLeague = seasonsList?.find((s) => s._id === leagueId);
  const leagueGroups = useMemo(
    () => groupSeasonsByLeague(seasonsList ?? []),
    [seasonsList],
  );

  const handleLeagueChange = (seasonId: string) => {
    if (currentUser) {
      setStoredLeagueId(currentUser._id, seasonId);
    }
    void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } });
  };

  return (
    <SharedAppHeader
      wordmark="league"
      glass
      // ~10% wider than the shared default (150 / 220).
      leagueButtonWidth={{ base: 165, sm: 242 }}
      selectedLeagueLabel={selectedLeague?.name}
      // Every league's matchup this week on one page (routes/matchups.tsx) -
      // icon-only glass button right of the league switcher. marginRight
      // auto keeps it beside the switcher on mobile, where the controls row
      // spreads its pieces to the edges (see shared glass.module.css).
      modeSwitchSlot={
        <Link
          to="/matchups"
          className={glassClasses.iconButton}
          activeProps={{ className: glassClasses.iconButtonActive }}
          aria-label="Matchups"
          title="Matchups"
          style={{ marginRight: "auto" }}
        >
          <TicketStack size={18} strokeWidth={2.5} />
        </Link>
      }
      leagueMenuItems={
        <>
          {leagueGroups.map(({ latest, seasons }) => (
            <Menu.Item
              key={latest.leagueId}
              leftSection={
                seasons.some((s) => s._id === leagueId) ? (
                  <Check size={16} />
                ) : null
              }
              onClick={() => handleLeagueChange(latest._id)}
            >
              {latest.name}
            </Menu.Item>
          ))}
          <Menu.Divider />
          <Menu.Item
            leftSection={<Plus size={16} />}
            onClick={() => void navigate({ to: "/add-league" })}
          >
            Add League
          </Menu.Item>
        </>
      }
      // NFL-wide reference pages, not league content - kept out of the
      // league tabs (see league/$leagueId/route.tsx) and reachable with no
      // league selected.
      nflMenuItems={
        <>
          <Link to="/depthCharts" style={{ textDecoration: "none" }}>
            <Menu.Item component="span" leftSection={<LayoutGrid size={16} />}>
              Depth Charts
            </Menu.Item>
          </Link>
          <Link to="/injuries" style={{ textDecoration: "none" }}>
            <Menu.Item component="span" leftSection={<HeartPulse size={16} />}>
              Injuries
            </Menu.Item>
          </Link>
        </>
      }
      adminMenuItems={
        currentUser?.role === "super-admin" && (
          <>
            {leagueId && (
              // Design sandbox for the player-card redesign - see cards.tsx.
              <Link
                to="/league/$leagueId/cards"
                params={{ leagueId }}
                style={{ textDecoration: "none" }}
              >
                <Menu.Item
                  component="span"
                  leftSection={<GalleryVerticalEnd size={16} />}
                >
                  Cards
                </Menu.Item>
              </Link>
            )}
            <Link to="/admin" style={{ textDecoration: "none" }}>
              <Menu.Item component="span" leftSection={<ShieldCheck size={16} />}>
                Admin
              </Menu.Item>
            </Link>
            <Link to="/admin-data" style={{ textDecoration: "none" }}>
              <Menu.Item component="span" leftSection={<Database size={16} />}>
                Data
              </Menu.Item>
            </Link>
          </>
        )
      }
    />
  );
}
