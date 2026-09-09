import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@mantine/core";
import { useConvexAuth, useQuery } from "convex/react";
import { Check, Database, Plus, ShieldCheck } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import type { LinkedSeason } from "../types/season";

// Thin infinifaab-specific wrapper around @shared/AppHeader: backed by
// listMyAuctionSeasons instead of infinidraft's listSeasons so an invited
// team member sees the seasons they've been added to, not just ones they
// own, and its own "Connect League" footer item instead of "New League".
export function AppHeader() {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false });
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(api.users.getCurrentUser);
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listMyAuctionSeasons,
    isAuthenticated ? {} : "skip",
  );

  const selectedLeague = seasonsList?.find((s) => s._id === leagueId);
  const leagueGroups = useMemo(
    () => groupSeasonsByLeague(seasonsList ?? []),
    [seasonsList],
  );

  const handleLeagueChange = (seasonId: string) => {
    void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId } });
  };

  return (
    <SharedAppHeader
      wordmark="faab"
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
