import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react - see
// __root.tsx's comment on the same import for why (the latter's
// isAuthenticated doesn't wait for server confirmation).
import { useConvexAuth, useQuery } from "convex/react";
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
import { Plus } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { DRAFT_STATUS_META, type DraftStatus } from "../lib/draftStatus";
import { groupSeasonsByLeague } from "@shared/leagueGroups";
import { DRAFT_TYPE_OPTIONS } from "../constants/leagueSettings";
import { formatSleeperDraftSchedule } from "../lib/sleeperDraftSchedule";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

// What to call the "enter this league" button, depending on how far its
// draft has gotten - purely a label difference now (see EnterLeagueLink
// below), since every status lands in the same unified league view.
const ENTER_ACTION: Record<DraftStatus, { label: string }> = {
  pre_draft: { label: "Enter League" },
  in_progress: { label: "Enter Draft Room" },
  complete: { label: "Enter League" },
};

// Renders the <Link> for a league card - every draft status lands in the
// same unified league view (see routes/league/$leagueId), which adapts to
// phase (including "complete") on its own, so there's no separate
// destination to branch on anymore. Report Card (the one thing that used
// to live past a completed draft) moved to its own public link, reachable
// from AppHeader's overflow menu instead - see that component's comment.
// Settings (not league.tsx's live roster breakdown) is the general-purpose
// landing tab.
function EnterLeagueLink({
  leagueId,
  children,
}: {
  leagueId: string;
  children: ReactNode;
}) {
  const linkStyle = {
    display: "block",
    height: "100%",
    color: "inherit",
    textDecoration: "none",
  } as const;
  return (
    <Link
      to="/league/$leagueId/settings"
      params={{ leagueId }}
      style={linkStyle}
    >
      {children}
    </Link>
  );
}

// The app's home page - the logo (AppHeader.tsx) links here from everywhere
// else. Shows every league this user owns as a card, grouped by
// leagueId (see groupSeasonsByLeague) so multi-year leagues surface once,
// keyed to their most recent season.
function Dashboard() {
  const { isAuthenticated } = useConvexAuth();
  // __root.tsx only renders this route at all once it believes the user is
  // authenticated, but listSeasons throws (rather than degrading
  // gracefully) if that belief turns out to be premature - see
  // AppHeader.tsx's copy of this same guard for why isAuthenticated is
  // checked here directly instead of trusting the outer gate alone.
  const seasonsList = useQuery(
    api.leagues.listSeasons,
    isAuthenticated ? {} : "skip",
  );

  const leagueGroups = groupSeasonsByLeague(seasonsList ?? []).sort((a, b) =>
    a.latest.name.localeCompare(b.latest.name),
  );

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader hideLeagueControls />
        {seasonsList === undefined ? (
          <Center py="xl">
            <Loader />
          </Center>
        ) : leagueGroups.length === 0 ? (
          <Stack gap="md" py="xl" align="center">
            <Text c="dimmed">You don't have any leagues yet.</Text>
            <Link to="/league/$leagueId/settings" params={{ leagueId: "new" }}>
              <Button component="span" leftSection={<Plus size={16} />}>
                New League
              </Button>
            </Link>
          </Stack>
        ) : (
          <>
            <Group justify="flex-end">
              <Link
                to="/league/$leagueId/settings"
                params={{ leagueId: "new" }}
              >
                <Button
                  component="span"
                  variant="default"
                  leftSection={<Plus size={16} />}
                >
                  New League
                </Button>
              </Link>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {leagueGroups.map(({ latest }) => {
                const status = DRAFT_STATUS_META[latest.draftStatus];
                return (
                  <EnterLeagueLink key={latest.leagueId} leagueId={latest._id}>
                    <Card
                      withBorder
                      padding="lg"
                      style={{
                        cursor: "pointer",
                        textDecoration: "none",
                        color: "inherit",
                        height: "100%",
                      }}
                    >
                      <Stack gap="sm" justify="space-between" h="100%">
                        <Stack gap={4}>
                          <Group
                            justify="space-between"
                            wrap="nowrap"
                            align="flex-start"
                          >
                            <Text fw={600} lineClamp={2}>
                              {latest.name}
                            </Text>
                            <Badge
                              color={status.color}
                              variant="light"
                              style={{ flexShrink: 0 }}
                            >
                              {status.label}
                            </Badge>
                          </Group>
                          <Text size="sm" c="dimmed">
                            {latest.year} · {latest.teamCount} teams ·{" "}
                            {DRAFT_TYPE_OPTIONS.find(
                              (option) =>
                                option.value === (latest.draftType ?? "auction"),
                            )?.label ?? "Auction"}{" "}
                            · {latest.scoring}
                          </Text>
                          {latest.draftStatus === "pre_draft" &&
                            latest.sleeperDraftScheduledAt !== undefined && (
                              <Text size="xs" c="dimmed">
                                Draft:{" "}
                                {formatSleeperDraftSchedule(
                                  latest.sleeperDraftScheduledAt,
                                )}
                              </Text>
                            )}
                        </Stack>
                        <Button component="span" variant="light" fullWidth>
                          {ENTER_ACTION[latest.draftStatus].label}
                        </Button>
                      </Stack>
                    </Card>
                  </EnterLeagueLink>
                );
              })}
            </SimpleGrid>
          </>
        )}
      </Stack>
    </PageContainer>
  );
}
