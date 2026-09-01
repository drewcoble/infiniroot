import {
  Badge,
  Box,
  Card,
  Center,
  Divider,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Transition,
} from "@mantine/core";
import { useQuery } from "convex/react";
import { Fragment, useMemo, useState } from "react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { ColorSchemeToggle } from "../../components/ColorSchemeToggle";
import { RookieBadge } from "@shared/RookieBadge";
import { WEEK } from "../../constants/general";
import { useFitScale } from "../../hooks/useFitScale";
import { useRookieFpids } from "../../hooks/useRookieFpids";
import logo from "@shared/infini_logo.png";
import {
  POSITION_COLORS,
  positionColorOrDefault,
} from "@shared/positionColors";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { optimalAssignPicksToSlots } from "../../lib/slotAssignment";
import {
  pointsForScoringConfig,
  scoringConfigFromSeason,
} from "../../lib/relevantPlayers";
import {
  computeTeamBudgetStats,
  resolveTeamSalaryCap,
} from "../../lib/teamBudget";
import BudgetStats from "./BudgetStats";
import { SnakeDraftBoard } from "./SnakeDraftBoard";

interface DraftBoardProps {
  seasonId: Id<"seasons">;
}

// Reference width (unscaled) for one team card, used only for the very
// first paint - boardCols * this is a starting width for the content box so
// useFitScale has something to measure a "natural" size against before it's
// had a chance to compute anything itself (without it there'd be nothing
// for Mantine's SimpleGrid, which stretches its columns to fill 100% of
// whatever width its container is given, to size itself against - a
// circular fill-to-my-own-intrinsic-size dependency). Every render after
// that, useFitScale's `contentWidth` takes over and replaces this: it
// solves for whichever width, once scaled down/up by `scale`, exactly fills
// the container, so if height ends up the binding constraint (as it does on
// a squarer/taller screen where 2 rows of cards run tall relative to their
// width) the grid's columns stretch to use the leftover horizontal space
// instead of leaving it as a dead margin.
const REFERENCE_CARD_WIDTH = 320;

// Read-only, TV/projector-friendly view of every team's roster - meant to be
// opened in its own tab on a second screen while the host runs the actual
// draft elsewhere (see the "TV Board" link in AppHeader.tsx), so it
// deliberately shows only what's already public knowledge in a live
// auction: drafted players, prices paid, each team's remaining budget/max
// bid (every bidder needs to see max bids to bid validly), and - since the
// starting lineup itself is just a deterministic read of "who's the better
// player at this position," not a $-value/strategy signal - each team's
// current points-optimal starting lineup. It still never reads $ values
// (draftValues.ts's dollarValue), ADP, target/avoid tags (draftPlayerTags),
// or budget plans, which stay the host's private prep.
//
// Viewable any time, not just once the draft starts - a host might want it
// up on the TV before the room's ready to go. Nomination-status badges only
// make sense once there's actually a draft in progress, so a not-yet-started
// draft gets a plain "Draft not started" badge instead of chasing whatever
// stale nominatingTeam/turnTeam state happens to be sitting around.
export function DraftBoard({ seasonId }: DraftBoardProps) {
  // All queries below use their *Public variants (no ownership check) -
  // this page is meant to be opened by anyone with the link (see the file
  // comment above and src/routes/__root.tsx's isPublicRoute exemption for
  // /board/*), not just the signed-in league owner. getDraftValuesPublic in
  // particular exists because this screen frequently has nobody signed in
  // at all (it's the projector, not the host's own device) - see that
  // query's own comment for why it can't just reuse getDraftValues.
  const settings = useQuery(api.leagues.getSeasonPublic, { seasonId });
  const teams = useQuery(api.draft.teams.listSeasonTeamsPublic, { seasonId });
  const picks = useQuery(api.draft.picks.listDraftPicksPublic, { seasonId });
  const activeNomination = useQuery(api.draft.picks.getActiveNominationPublic, {
    seasonId,
  });
  const nominationConfig = useQuery(
    api.draft.nominationOrder.getNominationConfigPublic,
    { seasonId },
  );
  const currentNominator = useQuery(
    api.draft.nominationOrder.getCurrentNominatorPublic,
    nominationConfig?.nominationOrder ? { seasonId } : "skip",
  );
  const allProjections = useQuery(api.projections.getAllProjections, {
    week: WEEK,
  });
  const rookieFpids = useRookieFpids();

  const playerByFpid = useMemo(() => {
    const map = new Map<number, { name: string; team: string | null }>();
    for (const row of allProjections ?? []) map.set(row.fpid, row);
    return map;
  }, [allProjections]);

  // Sourced from raw projections (every player, keeper or not), NOT the $
  // value engine (`getDraftValuesPublic`'s `values`) - that pool
  // deliberately excludes keepers (they're off the auction board before it
  // even starts), which silently fell back to 0 points for every keeper
  // here and pushed them all to the bottom of the bench regardless of
  // their real projection (user report, 2026-08-30, same bug as
  // LeagueTab.tsx/MyTeamTab.tsx/SeasonSummary.tsx). Also drops this board's
  // only remaining dependency on the $ value engine, one step closer to
  // this file's own stated "never reads $ values" design (see the file
  // comment above) - it only ever needed `.points` off of it.
  const pointsByFpid = useMemo(() => {
    const map = new Map<number, number>();
    if (!settings) return map;
    const scoringConfig = scoringConfigFromSeason(settings);
    for (const row of allProjections ?? []) {
      map.set(row.fpid, pointsForScoringConfig(row, scoringConfig));
    }
    return map;
  }, [allProjections, settings]);

  const teamSummaries = useMemo(() => {
    if (!settings || !teams || !picks) return [];
    // Nomination order (when configured) takes precedence over each team's
    // static `order` field - the board should read left-to-right/top-to-
    // bottom in the order teams will actually nominate in, not whatever
    // order they were added to the league. Teams somehow missing from
    // nominationOrder (shouldn't normally happen - see
    // convex/draft/nominationOrder.ts) fall back to `order` as a tiebreak
    // and sort after every team that is listed.
    const nominationOrderIndex = new Map(
      (nominationConfig?.nominationOrder ?? []).map((teamId, index) => [
        teamId,
        index,
      ]),
    );
    return [...teams]
      .sort((a, b) => {
        if (nominationOrderIndex.size > 0) {
          const aIndex = nominationOrderIndex.get(a._id) ?? Infinity;
          const bIndex = nominationOrderIndex.get(b._id) ?? Infinity;
          if (aIndex !== bIndex) return aIndex - bIndex;
        }
        return a.order - b.order;
      })
      .map((team) => {
        const teamPicks = picks
          .filter((pick) => pick.teamId === team._id)
          .sort((a, b) => a.sequence - b.sequence);
        // Budget stats are auction-only (SNAKE_DRAFT.md §3.4/§12 - the
        // board needs its own snake-format column set eventually).
        const spent = teamPicks.reduce(
          (sum, pick) => sum + (pick.price ?? 0),
          0,
        );
        const stats = computeTeamBudgetStats(
          resolveTeamSalaryCap(team, settings.salaryCap),
          settings.rosterSlots,
          teamPicks.length,
          spent,
        );
        const slots = expandRosterSlots(settings.rosterSlots);
        const bySlot = optimalAssignPicksToSlots(
          teamPicks,
          settings.rosterSlots,
          settings.flexPositions,
          settings.superflexPositions,
          pointsByFpid,
        );
        return { team, stats, slots, bySlot };
      });
  }, [settings, teams, picks, nominationConfig, pointsByFpid]);

  const nominatingTeam = teams?.find(
    (team) => team._id === activeNomination?.nominatingTeamId,
  );
  const turnTeam = teams?.find(
    (team) => team._id === currentNominator?.currentTeamId,
  );

  // The nomination badges below animate in/out with Transition, which keeps
  // rendering its children for the duration of the exit animation even
  // after the underlying query result that drove them (nominatingTeam,
  // turnTeam, activeNomination) has already gone undefined. Without
  // remembering the last real value here, a badge would slide out showing
  // blank/undefined text instead of the info it was just displaying. Each
  // sticky value only updates while its source is defined, so it always
  // holds "the last real content" for its badge to animate away with.
  const [stickyNominatedTeam, setStickyNominatedTeam] = useState<{
    id: Id<"seasonTeams">;
    name: string;
  } | null>(null);
  if (nominatingTeam && nominatingTeam._id !== stickyNominatedTeam?.id) {
    setStickyNominatedTeam({
      id: nominatingTeam._id,
      name: nominatingTeam.name,
    });
  }
  const [stickyTurnTeam, setStickyTurnTeam] = useState<{
    id: Id<"seasonTeams">;
    name: string;
  } | null>(null);
  if (turnTeam && turnTeam._id !== stickyTurnTeam?.id) {
    setStickyTurnTeam({ id: turnTeam._id, name: turnTeam.name });
  }
  const [stickyOnBlock, setStickyOnBlock] = useState<{
    fpid: number;
    name: string;
    team: string | null;
    position: NonNullable<typeof activeNomination>["position"];
  } | null>(null);
  if (activeNomination && activeNomination.fpid !== stickyOnBlock?.fpid) {
    const player = playerByFpid.get(activeNomination.fpid);
    setStickyOnBlock({
      fpid: activeNomination.fpid,
      name: player?.name ?? `#${activeNomination.fpid}`,
      team: player?.team ?? null,
      position: activeNomination.position,
    });
  }
  // Whichever team the nominator indicator (below) is currently pointing
  // at - nominatingTeam while a player's up for bids, turnTeam once it's
  // resolved/passed and the board is waiting on the next nomination.
  const highlightedTeamId = activeNomination
    ? nominatingTeam?._id
    : turnTeam?._id;
  // Always exactly 2 rows, however many teams there are - this page is
  // built for a TV/projector, so a fixed (not viewport-responsive) column
  // count that guarantees everyone's roster is visible without scrolling
  // matters more here than reflowing nicely on a narrow screen.
  const boardCols = Math.max(1, Math.ceil(teamSummaries.length / 2));

  const { containerRef, contentRef, scale, contentWidth } = useFitScale();

  if (!settings || !teams || !picks) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // Absent means "auction" (see convex/draftType.ts's resolveDraftType). A
  // snake/linear draft's own shape (one slot per team per round, in a fixed
  // order) reads far better as a round-by-round grid than this team-roster
  // layout - see SnakeDraftBoard.tsx.
  const isAuction = (settings.draftType ?? "auction") === "auction";
  if (!isAuction) {
    return <SnakeDraftBoard seasonId={seasonId} />;
  }

  return (
    <Box
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        ref={contentRef}
        style={{
          width: contentWidth ?? boardCols * REFERENCE_CARD_WIDTH,
          // The container above is a flex row centering this box - without
          // this, the browser's default flex-shrink: 1 silently shrinks
          // this box down to the container's width whenever its own width
          // (set above) exceeds it, *before* useFitScale ever gets to
          // measure a natural size. That makes every measurement come back
          // capped at the container's width, which both breaks the scale
          // math (width always looks like a perfect fit, whatever the
          // content actually needs) and defeats contentWidth's attempt to
          // stretch into unused space.
          flexShrink: 0,
          transform: `scale(${scale})`,
        }}
      >
        <Stack gap="lg" p="lg">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group align="center" wrap="wrap">
              {/* No AppHeader on this page (see the file comment - deliberately
              bare for a second-screen/TV display), so the brand mark just
              sits inline at the front of this row instead, smaller than the
              league name since that's the thing actually worth reading from
              across the room. */}
              <Group gap={8} wrap="nowrap">
                <Image src={logo} alt="InfiniDraft" h={40} w="auto" />
                <Title order={3} c="var(--mantine-color-text)">
                  <Text component="span" inherit c="saddlebrown.7">
                    infini
                  </Text>
                  draft
                </Title>
              </Group>
              <Group gap="xs" wrap="wrap">
                {settings.draftStatus === "pre_draft" ? (
                  <Badge size="xl" radius="md" variant="light" color="gray">
                    Draft not started
                  </Badge>
                ) : (
                  <>
                    <Transition
                      mounted={!!(activeNomination && nominatingTeam)}
                      transition="slide-down"
                      duration={220}
                      timingFunction="ease-out"
                    >
                      {(styles) =>
                        stickyNominatedTeam ? (
                          <Badge
                            size="xl"
                            radius="md"
                            variant="light"
                            color="burlywood"
                            style={styles}
                          >
                            {stickyNominatedTeam.name} nominated
                          </Badge>
                        ) : (
                          <></>
                        )
                      }
                    </Transition>
                    <Transition
                      mounted={!!(!activeNomination && turnTeam)}
                      transition="slide-down"
                      duration={220}
                      timingFunction="ease-out"
                    >
                      {(styles) =>
                        stickyTurnTeam ? (
                          <Badge
                            size="xl"
                            radius="md"
                            variant="light"
                            color="saddlebrown.6"
                            style={styles}
                          >
                            {stickyTurnTeam.name}{" "}
                            {isAuction ? "is nominating" : "is on the clock"}
                          </Badge>
                        ) : (
                          <></>
                        )
                      }
                    </Transition>
                    {/* No nomination/bid step exists for a snake/linear
                        draft (SNAKE_DRAFT.md §3.1/§5.2) - activeNomination
                        is always undefined there, so this "on the block"
                        badge (and the "nominated" one above it) simply never
                        mount, same effect as an explicit isAuction guard. */}
                    <Transition
                      mounted={!!activeNomination}
                      transition="slide-down"
                      duration={220}
                      timingFunction="ease-out"
                    >
                      {(styles) =>
                        stickyOnBlock ? (
                          <Badge
                            size="xl"
                            radius="md"
                            variant="light"
                            color={`${POSITION_COLORS[stickyOnBlock.position]}`}
                            style={styles}
                          >
                            On the block: {stickyOnBlock.name} (
                            {stickyOnBlock.position}) - {stickyOnBlock.team}
                          </Badge>
                        ) : (
                          <></>
                        )
                      }
                    </Transition>
                  </>
                )}
              </Group>
            </Group>
            <Group align="center" gap="md" wrap="wrap">
              <Title order={2}>{settings.name}</Title>
              <ColorSchemeToggle />
            </Group>
          </Group>
          <SimpleGrid cols={boardCols} spacing="md">
            {teamSummaries.map(({ team, stats, slots, bySlot }) => (
              <Card
                key={team._id}
                withBorder
                padding="xs"
                radius="lg"
                bd={
                  team._id === highlightedTeamId
                    ? "3px solid var(--mantine-color-blue-7)"
                    : undefined
                }
                shadow={
                  team._id === highlightedTeamId
                    ? "0px 0px 15px 5px rgba(0, 0, 255, 0.05)"
                    : "inherit"
                }
              >
                <Stack gap={6}>
                  <Group
                    justify="space-between"
                    wrap="nowrap"
                    align="flex-start"
                  >
                    <Text
                      fw={700}
                      size="lg"
                      truncate
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      {team.name}
                    </Text>
                    {isAuction ? (
                      <BudgetStats stats={stats} />
                    ) : (
                      // No $ concept for snake/linear (SNAKE_DRAFT.md §3.4)
                      // - openSlots itself is format-agnostic (roster slots
                      // minus picks made), so just that much is reused.
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {stats.openSlots} open
                      </Text>
                    )}
                  </Group>

                  {slots.map((slot, slotIndex) => {
                    const pick = bySlot.get(slot.key);
                    const player = pick
                      ? playerByFpid.get(pick.fpid)
                      : undefined;
                    // Bench slots are always last (see SLOT_ORDER in
                    // rosterSlots.ts) and always labelled "BN<n>" - the
                    // divider marks the boundary the moment the label
                    // switches from a starter slot to the first bench one.
                    const isFirstBenchSlot =
                      slot.label.startsWith("BN") &&
                      !slots[slotIndex - 1]?.label.startsWith("BN");
                    return (
                      <Fragment key={slot.key}>
                        {isFirstBenchSlot && <Divider color="dark.7" />}
                        <Group
                          gap={10}
                          w="100%"
                          wrap="nowrap"
                          justify="space-between"
                        >
                          <Badge
                            size="sm"
                            variant="light"
                            color={positionColorOrDefault(slot.label)}
                            w={65}
                            style={{ flexShrink: 0 }}
                          >
                            {slot.label}
                          </Badge>
                          {/* flex: 1 (not a fixed width calc'd against the
                          other cells) so this absorbs whatever space is
                          left instead of assuming a fixed sibling total.
                          minWidth: 0 is required for a flex item to
                          actually truncate instead of overflowing its flex
                          basis. The keeper badge (when present) sits inside
                          this same cell, right after the name, rather than
                          its own column before price - name truncates
                          first if the two don't both fit. */}
                          <Group
                            gap={4}
                            wrap="nowrap"
                            style={{ flex: 1, minWidth: 0 }}
                          >
                            <Text
                              truncate
                              size="md"
                              fw={700}
                              ta="left"
                              style={{
                                flex: 1,
                                minWidth: 0,
                                letterSpacing: "0.3px",
                              }}
                            >
                              {player?.name ?? "-"}
                            </Text>
                            {pick && rookieFpids.has(pick.fpid) && (
                              <RookieBadge />
                            )}
                            {pick?.isKeeper && (
                              <Badge
                                size="sm"
                                variant="light"
                                color="gray"
                                style={{ flexShrink: 0 }}
                              >
                                {settings.keeperRules?.maxConsecutiveYears !==
                                undefined
                                  ? `K${pick.keeperStreak ?? 1}`
                                  : "K"}
                              </Badge>
                            )}
                          </Group>
                          <Text
                            size="md"
                            ta="right"
                            w={35}
                            fw={700}
                            style={{ flexShrink: 0 }}
                          >
                            {/* No $ concept outside auction (SNAKE_DRAFT.md
                                §3.4) - shows the round.pick instead. */}
                            {pick && isAuction
                              ? `$${pick.price ?? 0}`
                              : pick &&
                                  pick.round !== undefined &&
                                  pick.pickInRound !== undefined
                                ? `${pick.round}.${String(pick.pickInRound).padStart(2, "0")}`
                                : ""}
                          </Text>
                        </Group>
                      </Fragment>
                    );
                  })}
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Box>
    </Box>
  );
}
