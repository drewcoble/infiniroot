import { createFileRoute, Link } from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react's - see
// __root.tsx's comment on the same import.
import { useConvexAuth, useQuery } from "convex/react";
import {
  Button,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { Plus } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import type { LinkedSeason } from "../types/season";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

// infinifaab's league picker - every season the signed-in user can run an
// auction for, whether they own it or were invited onto one of its teams
// (see api.leagues.listMyAuctionSeasons), grouped by leagueId same as the
// other two apps' own dashboards.
function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  const seasonsList: LinkedSeason[] | undefined = useQuery(
    api.leagues.listMyAuctionSeasons,
    isAuthenticated ? {} : "skip",
  );

  const leagueGroups = groupSeasonsByLeague(seasonsList ?? []).sort((a, b) =>
    a.latest.name.localeCompare(b.latest.name),
  );

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        {seasonsList === undefined ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : leagueGroups.length === 0 ? (
          <Stack gap="md" py="xl" align="center">
            <Text c="dimmed">No leagues yet.</Text>
            <Link to="/connect-sleeper">
              <Button component="span" leftSection={<Plus size={16} />}>
                Connect League
              </Button>
            </Link>
          </Stack>
        ) : (
          <>
            <Group justify="flex-end">
              <Link to="/connect-sleeper">
                <Button
                  component="span"
                  variant="default"
                  leftSection={<Plus size={16} />}
                >
                  Connect League
                </Button>
              </Link>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {leagueGroups.map(({ latest }) => (
                <Link
                  key={latest.leagueId}
                  to="/league/$leagueId"
                  params={{ leagueId: latest._id }}
                  style={{
                    display: "block",
                    height: "100%",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <Card
                    withBorder
                    padding="lg"
                    style={{ cursor: "pointer", height: "100%" }}
                  >
                    <Stack gap="sm" justify="space-between" h="100%">
                      <Stack gap={4}>
                        <Text fw={600} lineClamp={2}>
                          {latest.name}
                        </Text>
                        <Text size="sm" c="dimmed">
                          {latest.year} · {latest.teamCount} teams ·{" "}
                          {latest.scoring}
                        </Text>
                      </Stack>
                      <Button component="span" variant="light" fullWidth>
                        Open Auction
                      </Button>
                    </Stack>
                  </Card>
                </Link>
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
