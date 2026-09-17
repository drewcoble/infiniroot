import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@mantine/core";
import { useConvexAuth, useQuery } from "convex/react";
import { Check, Database, Plus, ShieldCheck } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { setStoredLeagueId } from "../lib/leagueStorage";
import type { LinkedSeason } from "../types/season";

// Thin infinileague-specific wrapper around @shared/AppHeader: backed by
// listLinkedSeasons, and its own "Connect League" footer item instead of
// infinidraft's "New League" - no draft phase/status, no TV board/report
// card/billing/admin overflow items, no mode-switch button (none of those
// concepts exist here).
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
      selectedLeagueLabel={selectedLeague?.name}
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
            onClick={() => void navigate({ to: "/connect-sleeper" })}
          >
            Connect League
          </Menu.Item>
        </>
      }
      extraOverflowItems={
        currentUser?.role === "super-admin" && (
          <>
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
