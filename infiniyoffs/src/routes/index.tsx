import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge, Button, Card, Center, Group, Loader, SimpleGrid, Stack, Text } from "@mantine/core";
import { Plus } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { useMySeasons } from "../hooks/useMySeasons";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const SCORING_LABELS = { STD: "0 PPR", HALF: "0.5 PPR", PPR: "1 PPR" } as const;

// Every league the user commissions or was invited into (listMySeasons),
// one card per real-world league. Removing a league stays in infinileague/
// infinifaab - this app only reads.
function Dashboard() {
  const seasonsList = useMySeasons();
  const leagueGroups = groupSeasonsByLeague(seasonsList ?? []).sort((a, b) =>
    a.latest.name.localeCompare(b.latest.name),
  );

  const addLeague = (
    <Link to="/add-league">
      <Button component="span" variant="default" leftSection={<Plus size={16} />}>
        Add League
      </Button>
    </Link>
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
            {addLeague}
          </Stack>
        ) : (
          <>
            <Group justify="flex-end">{addLeague}</Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {leagueGroups.map(({ latest }) => (
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
                        {latest.year} · {latest.teamCount} teams · {SCORING_LABELS[latest.scoring]}
                      </Text>
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
