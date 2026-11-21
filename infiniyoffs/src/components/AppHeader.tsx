import { useMemo } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Menu } from "@mantine/core";
import { Check, Plus } from "lucide-react";
import { AppHeader as SharedAppHeader } from "@shared/AppHeader";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { useMySeasons } from "../hooks/useMySeasons";

// Thin infiniyoffs wrapper around @shared/AppHeader: infinileague's glass
// chrome, backed by listMySeasons so an invited member sees the leagues
// they've joined, not just ones they own.
export function AppHeader() {
  const navigate = useNavigate();
  const { leagueId } = useParams({ strict: false });
  const seasonsList = useMySeasons();

  const selectedLeague = seasonsList?.find((s) => s._id === leagueId);
  const leagueGroups = useMemo(() => groupSeasonsByLeague(seasonsList ?? []), [seasonsList]);

  return (
    <SharedAppHeader
      wordmark="yoffs"
      glass
      leagueButtonWidth={{ base: 165, sm: 242 }}
      selectedLeagueLabel={selectedLeague?.name}
      leagueMenuItems={
        <>
          {leagueGroups.map(({ latest, seasons }) => (
            <Menu.Item
              key={latest.leagueId}
              leftSection={seasons.some((s) => s._id === leagueId) ? <Check size={16} /> : null}
              onClick={() =>
                void navigate({ to: "/league/$leagueId", params: { leagueId: latest._id } })
              }
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
    />
  );
}
