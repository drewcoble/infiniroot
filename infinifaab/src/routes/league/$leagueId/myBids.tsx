import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Button, Center, Group, Loader, Stack, Text, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { PlayerCard } from "@shared/PlayerCard";
import { BidModal, type BidModalTarget } from "../../../components/BidModal";
import type { AuctionSettings, BidBoardRow, MyParticipation } from "../../../types/season";

export const Route = createFileRoute("/league/$leagueId/myBids")({
  component: BidsTab,
});

const SECTIONS: Array<{ category: BidBoardRow["category"]; title: string }> = [
  { category: "winning", title: "Winning" },
  { category: "outbid", title: "Outbid" },
  { category: "other", title: "Other Bids" },
];

// Every active bid this cycle, across every team in the league - not just
// the signed-in user's own (see api.infinileague.auction.bids.getBidsBoard,
// which already returns rows pre-grouped winning/outbid/other and pre-
// sorted by price then rank within each group - this just renders them in
// the three sections). Uses the same PlayerCard the Players tab does
// (BidBoardRow satisfies PlayerCardRow directly). "Other" rows only ever
// carry the same public currentPrice/leadingTeamName data the Players tab's
// board shows - never another team's real max bid.
function BidsTab() {
  const { leagueId } = Route.useParams();
  const seasonId = leagueId as Id<"seasons">;
  const { isAuthenticated } = useConvexAuth();

  const rows: BidBoardRow[] | undefined = useQuery(
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

  const [bidTarget, setBidTarget] = useState<BidModalTarget | null>(null);

  if (rows === undefined || participation === undefined || settings === undefined) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const openBidModal = (row: BidBoardRow) => {
    const initialAmount =
      row.myMaxBid !== null ? row.myMaxBid + settings.minIncrement : row.currentPrice;
    setBidTarget({ fpid: row.fpid, name: row.name, initialAmount });
  };

  return (
    <Stack gap="lg">
      {rows.length === 0 ? (
        <Stack gap="xs" py="xl" align="center">
          <Text c="dimmed">No active bids this cycle.</Text>
        </Stack>
      ) : (
        SECTIONS.map(({ category, title }) => {
          const sectionRows = rows.filter((row) => row.category === category);
          if (sectionRows.length === 0) return null;
          return (
            <Stack key={category} gap={8}>
              <Title order={5}>{title}</Title>
              {sectionRows.map((row) => {
                // Same green/red convention as the Players tab - not the
                // whole card (tried that, too visually loud).
                const statusColor =
                  row.category === "winning" ? "green" : row.category === "outbid" ? "red" : undefined;
                return (
                  <PlayerCard
                    key={row.fpid}
                    row={row}
                    isRookie={false}
                    footer={
                      <Group justify="space-between" wrap="nowrap" gap={8}>
                        <Stack gap={0}>
                          <Text size="sm" fw={700} {...(statusColor ? { c: statusColor } : {})} truncate>
                            ${row.currentPrice}
                            {row.leadingTeamName ? ` - ${row.leadingTeamName}` : ""}
                          </Text>
                          <Text size="xs" c={statusColor ?? "dimmed"} truncate>
                            ({row.bidCount} bid{row.bidCount === 1 ? "" : "s"})
                            {row.myMaxBid !== null ? ` - your max: $${row.myMaxBid}` : ""}
                          </Text>
                        </Stack>
                        <Button
                          size="xs"
                          variant="light"
                          disabled={participation.teams.length === 0}
                          onClick={() => openBidModal(row)}
                        >
                          {row.category === "other" ? "Bid" : "Increase max bid"}
                        </Button>
                      </Group>
                    }
                  />
                );
              })}
            </Stack>
          );
        })
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
