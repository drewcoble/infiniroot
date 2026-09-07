import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  MultiSelect,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { Search } from "lucide-react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { api } from "@infinidata/api";
import { PlayerCard } from "@shared/PlayerCard";
import { getErrorMessage } from "@shared/errors";
import { BidModal, type BidModalTarget } from "../../../components/BidModal";
import { formatCountdown } from "../../../lib/countdown";
import type {
  AuctionBoardRow,
  AuctionCycle,
  AuctionSettings,
  BidBoardRow,
  CycleType,
  ManualCycleCandidateRow,
  MyBidRow,
  MyParticipation,
  WaiverPlayerRow,
} from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/players")({
  component: PlayersTab,
});

// A real league's full waiver pool can be thousands of players (see the
// Shadynasty's bug writeup - 2,950 eligible for one 10-team league), so
// this is windowed against the page's own scroll the same way infinileague's
// own Players tab is (useWindowVirtualizer) - only cards actually in the
// viewport are ever mounted. Unlike that page, this card's footer (current
// price/leading team/bid button) makes each row's real height less
// predictable than infinileague's fixed PLAYER_CARD_HEIGHT constant (extra
// injury badges, longer team names, etc.), so this measures each rendered
// card's real height (measureElement) instead of trusting a single
// hardcoded estimate.
const ESTIMATED_ROW_HEIGHT = 110;

// Several cycles (the weekly one plus any number of drop-triggered/
// commissioner ones) can be open at once now - this labels a card's own
// cycle when it isn't the regular weekly one, so its independent close time
// doesn't read as a typo against the weekly banner above it.
const CYCLE_TYPE_LABEL: Record<CycleType, string | null> = {
  weekly: null,
  playerDrop: "Drop window",
  manual: "Commissioner cycle",
};

function boardKey(cycleId: string, fpid: number): string {
  return `${cycleId}:${fpid}`;
}

function PlayersTab() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const players: WaiverPlayerRow[] | undefined = useQuery(
    api.infinileague.auction.players.getWaiverEligiblePlayers,
    isAuthenticated ? { seasonId } : "skip",
  );
  const board:
    | { openCycles: AuctionCycle[]; rows: AuctionBoardRow[] }
    | undefined = useQuery(
    api.infinileague.auction.bids.getAuctionBoardState,
    isAuthenticated ? { seasonId } : "skip",
  );
  const myBids: MyBidRow[] | undefined = useQuery(
    api.infinileague.auction.bids.getMyBids,
    isAuthenticated ? { seasonId } : "skip",
  );
  // Reused for its winning/outbid categorization (see getBidsBoard's own
  // comment) - compares by teamId under the hood, unlike this file's own
  // boardByKey/myBidsByKey maps, which only carry team names and can't
  // safely tell "leading team" and "my team" apart by string match alone.
  const bidsBoard: BidBoardRow[] | undefined = useQuery(
    api.infinileague.auction.bids.getBidsBoard,
    isAuthenticated ? { seasonId } : "skip",
  );
  const participation: MyParticipation | undefined = useQuery(
    api.infinileague.auction.participant.getMyParticipation,
    isAuthenticated ? { seasonId } : "skip",
  );
  const settings: AuctionSettings | undefined = useQuery(
    api.infinileague.auction.settings.getAuctionSettings,
    isAuthenticated ? { seasonId } : "skip",
  );
  const rookieFpids = useQuery(
    api.players.getRookieFpids,
    isAuthenticated ? {} : "skip",
  );
  const rookieFpidSet = new Set(rookieFpids ?? []);
  const isCommissioner = participation?.isCommissioner ?? false;
  const manualCandidates: ManualCycleCandidateRow[] | undefined = useQuery(
    api.infinileague.auction.players.listManualCycleCandidates,
    isAuthenticated && isCommissioner ? { seasonId } : "skip",
  );

  const openCycleNow = useMutation(api.infinileague.auction.cycles.openAuctionCycleNow);
  const closeCycleNow = useMutation(api.infinileague.auction.cycles.closeAuctionCycleNow);
  const startManualCycle = useMutation(api.infinileague.auction.cycles.startManualAuctionCycle);

  const [bidTarget, setBidTarget] = useState<BidModalTarget | null>(null);
  const [testDuration, setTestDuration] = useState<number | "">(60);
  const [cycleActionError, setCycleActionError] = useState<string | null>(null);
  const [cycleActionLoading, setCycleActionLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [manualFpids, setManualFpids] = useState<string[]>([]);
  const [manualDuration, setManualDuration] = useState<number | "">(60);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualLoading, setManualLoading] = useState(false);

  // Same simple client-side substring match infinidraft's own PlayersLeftTab
  // uses for its search box - one query narrows the whole (potentially
  // thousands-deep, see ESTIMATED_ROW_HEIGHT's comment) list at once.
  const query = search.trim().toLowerCase();
  const filteredPlayers = (players ?? []).filter((row) =>
    query ? row.name.toLowerCase().includes(query) : true,
  );

  // Hooks must run unconditionally every render, so the virtualizer is set
  // up here (using the not-yet-loaded-safe filteredPlayers, itself already
  // `?? []`-safe) rather than after the loading early-return below.
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: filteredPlayers.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (
    players === undefined ||
    board === undefined ||
    myBids === undefined ||
    bidsBoard === undefined ||
    participation === undefined ||
    settings === undefined
  ) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const weeklyCycle = board.openCycles.find((c) => (c.type ?? "weekly") === "weekly") ?? null;

  const categoryByKey = new Map(bidsBoard.map((r) => [boardKey(r.cycleId, r.fpid), r.category]));
  const boardByKey = new Map(board.rows.map((r) => [boardKey(r.cycleId, r.fpid), r]));
  const myBidsByKey = new Map<string, MyBidRow[]>();
  for (const bid of myBids) {
    const key = boardKey(bid.cycleId, bid.fpid);
    const list = myBidsByKey.get(key) ?? [];
    list.push(bid);
    myBidsByKey.set(key, list);
  }

  const openBidModal = (row: WaiverPlayerRow) => {
    if (!row.cycleId) return;
    const key = boardKey(row.cycleId, row.fpid);
    const existingMax = myBidsByKey.get(key)?.[0]?.maxBid;
    const boardRow = boardByKey.get(key);
    const initialAmount =
      existingMax !== undefined
        ? existingMax + settings.minIncrement
        : boardRow
          ? boardRow.currentPrice
          : settings.startingBid;
    setBidTarget({ fpid: row.fpid, name: row.name, initialAmount });
  };

  const handleOpenNow = async () => {
    if (testDuration === "") return;
    setCycleActionLoading(true);
    setCycleActionError(null);
    try {
      await openCycleNow({ seasonId, durationMinutes: testDuration });
    } catch (err) {
      setCycleActionError(getErrorMessage(err, "Failed to open the auction."));
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleCloseNow = async () => {
    setCycleActionLoading(true);
    setCycleActionError(null);
    try {
      await closeCycleNow({ seasonId });
    } catch (err) {
      setCycleActionError(getErrorMessage(err, "Failed to close the auction."));
    } finally {
      setCycleActionLoading(false);
    }
  };

  const handleStartManualCycle = async () => {
    if (manualFpids.length === 0 || manualDuration === "") return;
    setManualLoading(true);
    setManualError(null);
    try {
      await startManualCycle({
        seasonId,
        fpids: manualFpids.map((v) => Number(v)),
        durationMinutes: manualDuration,
      });
      setManualFpids([]);
    } catch (err) {
      setManualError(getErrorMessage(err, "Failed to start the bid cycle."));
    } finally {
      setManualLoading(false);
    }
  };

  return (
    <Stack gap="md">
      {!weeklyCycle && (
        <Stack gap="xs">
          <Alert color="yellow" variant="light">
            No weekly auction window is open right now
            {!settings.enabled ? " and the weekly schedule is off." : " - check back soon."}
          </Alert>
          {isCommissioner && (
            <Group>
              <NumberInput
                label="Duration (minutes)"
                min={1}
                value={testDuration}
                onChange={(value) => setTestDuration(typeof value === "number" ? value : "")}
                w={160}
              />
              <Button
                onClick={() => void handleOpenNow()}
                loading={cycleActionLoading}
                disabled={testDuration === ""}
                style={{ alignSelf: "flex-end" }}
              >
                Open auction now
              </Button>
            </Group>
          )}
        </Stack>
      )}
      {weeklyCycle && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Closes in {formatCountdown(weeklyCycle.closesAt)}
          </Text>
          {isCommissioner && (
            <Button
              size="xs"
              color="red"
              variant="light"
              onClick={() => void handleCloseNow()}
              loading={cycleActionLoading}
            >
              Close now
            </Button>
          )}
        </Group>
      )}
      {cycleActionError && (
        <Alert color="red" variant="light">
          {cycleActionError}
        </Alert>
      )}

      {isCommissioner && (
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Title order={5}>Start a bid cycle for specific players</Title>
            <Text size="sm" c="dimmed">
              Hand-pick one or more free agents (not currently on a roster or
              in another open bid cycle) and run a dedicated auction for them,
              independent of the weekly schedule.
            </Text>
            <MultiSelect
              placeholder="Search players..."
              searchable
              clearable
              data={(manualCandidates ?? []).map((c) => ({
                value: String(c.fpid),
                label: c.team ? `${c.name} (${c.position} - ${c.team})` : `${c.name} (${c.position})`,
              }))}
              value={manualFpids}
              onChange={setManualFpids}
              disabled={manualCandidates === undefined}
            />
            <Group align="flex-end">
              <NumberInput
                label="Duration (minutes)"
                min={1}
                value={manualDuration}
                onChange={(value) => setManualDuration(typeof value === "number" ? value : "")}
                w={160}
              />
              <Button
                onClick={() => void handleStartManualCycle()}
                loading={manualLoading}
                disabled={manualFpids.length === 0 || manualDuration === ""}
              >
                Start bid cycle
              </Button>
            </Group>
            {manualError && (
              <Alert color="red" variant="light">
                {manualError}
              </Alert>
            )}
          </Stack>
        </Card>
      )}

      {players.length > 0 && (
        <TextInput
          placeholder="Search players..."
          leftSection={<Search size={16} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      )}

      {players.length === 0 ? (
        <Stack gap="xs" py="xl" align="center">
          <Text c="dimmed">No players are currently on waivers.</Text>
        </Stack>
      ) : filteredPlayers.length === 0 ? (
        <Stack gap="xs" py="xl" align="center">
          <Text c="dimmed">No players match your search.</Text>
        </Stack>
      ) : (
        <div ref={listRef} style={{ position: "relative", height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = filteredPlayers[item.index];
            if (!row) return null;
            const key = row.cycleId ? boardKey(row.cycleId, row.fpid) : null;
            const boardRow = key ? boardByKey.get(key) : undefined;
            const myMax = key ? myBidsByKey.get(key)?.[0]?.maxBid : undefined;
            const category = key ? categoryByKey.get(key) : undefined;
            // Colors the price/leader text green when winning, red when
            // outbid - not the whole card (tried that, too visually loud;
            // see recent commit history) - undefined falls back to each
            // Text's own default/dimmed color below.
            const statusColor =
              category === "winning" ? "green" : category === "outbid" ? "red" : undefined;
            const cycleLabel = CYCLE_TYPE_LABEL[row.cycleType];
            return (
              <div
                key={row.fpid}
                ref={virtualizer.measureElement}
                data-index={item.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  paddingBottom: 8,
                  transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                }}
              >
                <PlayerCard
                  row={row}
                  isRookie={rookieFpidSet.has(row.fpid)}
                  footer={
                    <Group justify="space-between" wrap="nowrap" gap={8}>
                      <Stack gap={0}>
                        {boardRow && (
                          <>
                            <Text size="sm" fw={700} {...(statusColor ? { c: statusColor } : {})} truncate>
                              ${boardRow.currentPrice}
                              {boardRow.leadingTeamName ? ` - ${boardRow.leadingTeamName}` : ""}
                            </Text>
                            <Text size="xs" c={statusColor ?? "dimmed"} truncate>
                              ({boardRow.bidCount} bid{boardRow.bidCount === 1 ? "" : "s"})
                              {myMax !== undefined ? ` - your max: $${myMax}` : ""}
                            </Text>
                          </>
                        )}
                        {(cycleLabel || row.closesAt !== undefined) && (
                          <Text size="xs" c="dimmed" truncate>
                            {cycleLabel ? `${cycleLabel}` : ""}
                            {cycleLabel && row.closesAt !== undefined ? " - " : ""}
                            {row.closesAt !== undefined
                              ? `closes in ${formatCountdown(row.closesAt)}`
                              : ""}
                          </Text>
                        )}
                      </Stack>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={!row.cycleId || participation.teams.length === 0}
                        onClick={() => openBidModal(row)}
                      >
                        Bid
                      </Button>
                    </Group>
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      <BidModal
        seasonId={seasonId}
        target={bidTarget}
        onClose={() => setBidTarget(null)}
        teams={participation.teams}
      />
    </Stack>
  );
}
