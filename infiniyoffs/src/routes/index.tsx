import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Button, Center, Group, Loader, Modal, SimpleGrid, Stack, Text } from "@mantine/core";
import { ChevronRight, Plus } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import glass from "@shared/glass/GlassMatchupCard.module.css";
import { pillStyle } from "@shared/glass/pills";
import { TeamLogo } from "@shared/glass/TeamLogo";
import modal from "../components/GlassModal.module.css";
import { useMySeasons, type YoffsSeason } from "../hooks/useMySeasons";

interface DashboardSearch {
  connect?: boolean;
}

// ?connect=1 opens the connect dialog (the header menu's "Connect a
// league" lands here).
export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): DashboardSearch =>
    search.connect === true || search.connect === "1" || search.connect === 1
      ? { connect: true }
      : {},
  component: Dashboard,
});

const SCORING_LABELS = { STD: "0 PPR", HALF: "0.5 PPR", PPR: "1 PPR" } as const;

// "Add a league"'s icon, in a league logo's tile.
const PLUS_TILE = [glass.teamLogo, glass.teamLogoInitials, glass.leagueLogo, glass.teamCardLogo]
  .join(" ");

// The leagues on infiniyoffs, one card per real-world league. The
// commissioner's other leagues wait in the connect dialog - most leagues
// never use custom playoffs, so they stay off this screen until set up.
function Dashboard() {
  const navigate = useNavigate();
  const { connect } = Route.useSearch();
  const seasonsList = useMySeasons();
  const setInYoffs = useMutation(api.infiniyoffs.leagues.setInYoffs);
  const [connecting, setConnecting] = useState<string | null>(null);

  const byName = (a: { latest: YoffsSeason }, b: { latest: YoffsSeason }) =>
    a.latest.name.localeCompare(b.latest.name);
  const seasons = seasonsList ?? [];
  const onYoffs = groupSeasonsByLeague(seasons.filter((s) => s.inYoffs)).sort(byName);
  const onLeagueIds = new Set(onYoffs.map((group) => group.latest.leagueId));
  // The commissioner's leagues with no season on infiniyoffs yet.
  const others = groupSeasonsByLeague(
    seasons.filter((s) => s.isCommissioner && !onLeagueIds.has(s.leagueId)),
  ).sort(byName);

  const setConnectOpen = (open: boolean) =>
    void navigate({ to: "/", search: open ? { connect: true } : {}, replace: true });

  const setUp = async (season: YoffsSeason) => {
    setConnecting(season._id);
    try {
      await setInYoffs({ seasonId: season._id as Id<"seasons">, inYoffs: true });
      await navigate({ to: "/league/$leagueId/setup", params: { leagueId: season._id } });
    } finally {
      setConnecting(null);
    }
  };

  const connectButton = (
    <Button variant="default" leftSection={<Plus size={16} />} onClick={() => setConnectOpen(true)}>
      Connect a league
    </Button>
  );

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        {seasonsList === undefined ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : onYoffs.length === 0 ? (
          <Stack gap="md" py="xl" align="center">
            <Text c="dimmed" ta="center">
              Run custom playoffs for your league.
            </Text>
            {connectButton}
          </Stack>
        ) : (
          <>
            <Group justify="flex-end">{connectButton}</Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm">
              {onYoffs.map(({ latest }) => (
                <Link
                  key={latest.leagueId}
                  to={latest.needsSetup ? "/league/$leagueId/setup" : "/league/$leagueId"}
                  params={{ leagueId: latest._id }}
                  className={`${glass.card} ${glass.wide} ${glass.teamCard}`}
                >
                  <LeagueRow season={latest} />
                  {latest.isCommissioner && (
                    <span
                      className={glass.pill}
                      style={{
                        ...pillStyle(latest.needsSetup ? "yellow" : "gray"),
                        gridArea: "points",
                        gridRowEnd: "span 2",
                      }}
                    >
                      {latest.needsSetup ? "Finish setup" : "Commish"}
                    </span>
                  )}
                  <ChevronRight
                    className={glass.teamCardChevron}
                    size={18}
                    strokeWidth={2.5}
                    aria-hidden
                  />
                </Link>
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>

      <Modal
        opened={connect === true}
        onClose={() => setConnectOpen(false)}
        title="Connect a league"
        centered
        classNames={modal}
      >
        <Stack gap="sm">
          {others.length > 0 && (
            <>
              <span className={glass.sectionLabel}>Your leagues not on yoffs yet</span>
              {others.map(({ latest }) => (
                <div
                  key={latest.leagueId}
                  className={`${glass.card} ${glass.wide} ${glass.teamCard}`}
                  style={{ cursor: "default" }}
                >
                  <LeagueRow season={latest} />
                  <Button
                    size="xs"
                    style={{ gridArea: "points", gridRowEnd: "span 2" }}
                    loading={connecting === latest._id}
                    onClick={() => void setUp(latest)}
                  >
                    Set up
                  </Button>
                </div>
              ))}
            </>
          )}
          <Link to="/add-league" className={`${glass.card} ${glass.wide} ${glass.teamCard}`}>
            <span
              className={PLUS_TILE}
              style={{ width: 40, height: 40, borderRadius: 12 }}
            >
              <Plus size={20} />
            </span>
            <div className={`${glass.wideName} ${glass.teamCardName}`}>
              <span className={glass.name}>Add a league</span>
            </div>
            <div className={`${glass.wideDetail} ${glass.teamCardSecondary}`}>
              From Sleeper, Yahoo or ESPN
            </div>
            <ChevronRight
              className={glass.teamCardChevron}
              size={18}
              strokeWidth={2.5}
              aria-hidden
            />
          </Link>
        </Stack>
      </Modal>
    </PageContainer>
  );
}

// A league's logo, name and season line - the glass teamCard's left side.
function LeagueRow({ season }: { season: YoffsSeason }) {
  return (
    <>
      <TeamLogo
        name={season.name}
        logoUrl={season.logoUrl}
        size={40}
        className={`${glass.teamCardLogo} ${glass.leagueLogo}`}
      />
      <div className={`${glass.wideName} ${glass.teamCardName}`}>
        <span className={glass.name}>{season.name}</span>
      </div>
      <div className={`${glass.wideDetail} ${glass.teamCardSecondary}`}>
        {season.year} · {season.teamCount} teams · {SCORING_LABELS[season.scoring]}
      </div>
    </>
  );
}
