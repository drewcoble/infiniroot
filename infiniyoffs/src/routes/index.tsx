import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { Plus } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
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
      await navigate({ to: "/league/$leagueId/settings", params: { leagueId: season._id } });
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
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {onYoffs.map(({ latest }) => (
                <Link
                  key={latest.leagueId}
                  to="/league/$leagueId"
                  params={{ leagueId: latest._id }}
                  style={{ display: "block", color: "inherit", textDecoration: "none" }}
                >
                  <Card padding="lg" style={{ cursor: "pointer", height: "100%" }}>
                    <Stack gap={4}>
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <Text fw={600} lineClamp={2}>
                          {latest.name}
                        </Text>
                        {latest.isCommissioner && (
                          <Badge variant="light" color="gray">
                            Commish
                          </Badge>
                        )}
                      </Group>
                      <Text size="sm" c="dimmed">
                        {latest.year} · {latest.teamCount} teams ·{" "}
                        {SCORING_LABELS[latest.scoring]}
                      </Text>
                    </Stack>
                  </Card>
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
      >
        <Stack gap="sm">
          {others.length > 0 && (
            <>
              <Text size="sm" c="dimmed">
                Your leagues not on yoffs yet:
              </Text>
              {others.map(({ latest }) => (
                <Group key={latest.leagueId} justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {latest.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {latest.year} · {latest.teamCount} teams
                    </Text>
                  </Stack>
                  <Button
                    size="xs"
                    loading={connecting === latest._id}
                    onClick={() => void setUp(latest)}
                  >
                    Set up
                  </Button>
                </Group>
              ))}
            </>
          )}
          <Link to="/add-league">
            <Button component="span" variant="default" fullWidth leftSection={<Plus size={16} />}>
              Add from Sleeper, Yahoo or ESPN
            </Button>
          </Link>
        </Stack>
      </Modal>
    </PageContainer>
  );
}
