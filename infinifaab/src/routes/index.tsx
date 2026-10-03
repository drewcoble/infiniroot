import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { Import, Plus } from "lucide-react";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { getErrorMessage } from "@shared/errors";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { useMyAuctionSeasons, type LinkedSeason } from "@shared-core/useMyAuctionSeasons";
import { useSetAuctionEnabled } from "@shared-core/useSetAuctionEnabled";
import type { GenericId as Id } from "convex/values";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

// infinifaab's league picker - every season the signed-in user can run an
// auction for, whether they own it or were invited onto one of its teams
// (see api.leagues.listMyAuctionSeasons), grouped by leagueId same as the
// other two apps' own dashboards.
function Dashboard() {
  const seasonsList = useMyAuctionSeasons();

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
            <Group>
              <Link to="/connect-sleeper">
                <Button component="span" leftSection={<Plus size={16} />}>
                  Connect Sleeper League
                </Button>
              </Link>
              <Link to="/connect-yahoo">
                <Button
                  component="span"
                  variant="default"
                  leftSection={<Import size={16} />}
                >
                  Import from Yahoo
                </Button>
              </Link>
            </Group>
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
                  Connect Sleeper League
                </Button>
              </Link>
              <Link to="/connect-yahoo">
                <Button
                  component="span"
                  variant="default"
                  leftSection={<Import size={16} />}
                >
                  Import from Yahoo
                </Button>
              </Link>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {leagueGroups.map(({ latest }) => (
                <LeagueCard key={latest.leagueId} season={latest} />
              ))}
            </SimpleGrid>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}

// A league whose weekly auction isn't enabled yet isn't navigable at all
// (the /league/$leagueId shell itself blocks entry - see route.tsx) - so
// this card is the one place that action lives, rather than being buried on
// the Settings tab a user could easily miss (which is exactly what caused
// confusion: browsing a "live" board that was actually turned off). Owners
// get an inline enable button right here; non-owners just see why the card
// isn't clickable yet.
function LeagueCard({ season }: { season: LinkedSeason }) {
  const setAuctionEnabled = useSetAuctionEnabled();
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnable = async () => {
    setEnabling(true);
    setError(null);
    try {
      await setAuctionEnabled({ seasonId: season._id as Id<"seasons">, enabled: true });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to enable the auction."));
    } finally {
      setEnabling(false);
    }
  };

  const body = (
    <Card padding="lg" style={{ height: "100%" }}>
      <Stack gap="sm" justify="space-between" h="100%">
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <Text fw={600} lineClamp={2}>
              {season.name}
            </Text>
            <Badge color={season.auctionEnabled ? "green" : "gray"} variant="light">
              {season.auctionEnabled ? "Auction on" : "Auction off"}
            </Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {season.year} · {season.teamCount} teams · {season.scoring}
          </Text>
        </Stack>
        {season.auctionEnabled ? (
          <Button component="span" variant="light" fullWidth>
            Open Auction
          </Button>
        ) : season.isOwner ? (
          <Stack gap={4}>
            <Button
              variant="light"
              color="green"
              fullWidth
              loading={enabling}
              onClick={() => void handleEnable()}
            >
              Enable weekly auction
            </Button>
            {error && (
              <Text size="xs" c="red">
                {error}
              </Text>
            )}
          </Stack>
        ) : (
          <Text size="xs" c="dimmed">
            Ask your commissioner to enable the weekly auction.
          </Text>
        )}
      </Stack>
    </Card>
  );

  if (!season.auctionEnabled) {
    return body;
  }

  return (
    <Link
      to="/league/$leagueId"
      params={{ leagueId: season._id }}
      style={{ display: "block", height: "100%", color: "inherit", textDecoration: "none" }}
    >
      <div style={{ cursor: "pointer", height: "100%" }}>{body}</div>
    </Link>
  );
}
