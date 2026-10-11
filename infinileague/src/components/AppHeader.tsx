import { useMemo } from "react";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
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
  Ticket,
} from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { setStoredLeagueId } from "../lib/leagueStorage";
import type { LinkedSeason } from "../types/season";

// Thin infinileague-specific wrapper around @shared/AppHeader: backed by
// listLinkedSeasons, and its own "Add League" footer item instead of
// infinidraft's "New League" - no draft phase/status, no TV board/report
// card/billing overflow items, no mode-switch button (none of those
// concepts exist here).
export function AppHeader() {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false });
  const onMatchups = useLocation().pathname === "/matchups";
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
      selectedLeagueLabel={onMatchups ? "Matchups" : selectedLeague?.name}
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
          {/* Every league's matchup this week on one page - see
              routes/matchups.tsx. */}
          <Menu.Item
            leftSection={onMatchups ? <Check size={16} /> : <Ticket size={16} />}
            onClick={() => void navigate({ to: "/matchups" })}
          >
            Matchups
          </Menu.Item>
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
