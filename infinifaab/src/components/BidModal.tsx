import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { api } from "@infinidata/api";
import { EditableNumberStepper } from "@shared/NumberStepper";
import { getErrorMessage } from "@shared/errors";

export interface BidModalTarget {
  fpid: number;
  name: string;
  initialAmount: number;
}

interface BidModalProps {
  seasonId: Id<"seasons">;
  target: BidModalTarget | null;
  onClose: () => void;
  teams: Array<{ teamId: string; name: string }>;
}

// Shared "place a bid" dialog - both the Players tab (bidding on a player
// with no prior bid) and the Bids tab ("Increase max bid" on one you're
// already winning/outbid on) open the exact same modal rather than each
// keeping their own copy of this state/submit logic.
export function BidModal({ seasonId, target, onClose, teams }: BidModalProps) {
  const placeBid = useMutation(api.infinileague.auction.bids.placeBid);
  const [bidTeamId, setBidTeamId] = useState<string | null>(null);
  const [bidAmount, setBidAmount] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setBidTeamId(teams[0]?.teamId ?? null);
      setBidAmount(target.initialAmount);
      setError(null);
    }
    // Only reset when the target itself changes (a new modal open) - not
    // on every `teams` reference change from a parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const handleSubmit = async () => {
    if (!target || !bidTeamId || bidAmount === "") return;
    setSubmitting(true);
    setError(null);
    try {
      await placeBid({
        seasonId,
        teamId: bidTeamId as Id<"seasonTeams">,
        fpid: target.fpid,
        maxBid: bidAmount,
      });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to place bid."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target ? `Bid on ${target.name}` : ""}
      // Mantine's default scroll lock (react-remove-scroll) manipulates
      // position/transform on <body> while a modal is open to block
      // background scrolling - on mobile Safari this can fail to fully
      // clean up afterward, leaving <body> in a state that breaks every
      // position:fixed element's containing block for the rest of the
      // session (reported: the app's fixed BottomNav stops tracking the
      // real viewport after opening this modal). Not worth the tradeoff
      // for a small dialog like this one.
      lockScroll={false}
    >
      <Stack gap="sm">
        {teams.length > 1 && (
          <Select
            label="Bidding as"
            data={teams.map((t) => ({ value: t.teamId, label: t.name }))}
            value={bidTeamId}
            onChange={setBidTeamId}
            // Both this dropdown and the Modal itself portal to
            // document.body, so they stack by z-index, not DOM nesting -
            // bump this one above the Modal's own z-index (200) so it
            // renders on top. Tried `withinPortal: false` (rendering the
            // dropdown inline inside the Modal's own subtree) first, but
            // that broke the app's fixed BottomNav elsewhere on the page -
            // Mantine's Modal scroll-lock (react-remove-scroll) apparently
            // doesn't expect a Combobox mounted inside its own DOM subtree
            // instead of body-level, and got left in a bad state. A plain
            // z-index bump keeps both portals independent, avoiding that
            // interaction entirely.
            comboboxProps={{ zIndex: 1000 }}
          />
        )}
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Your max bid
          </Text>
          <EditableNumberStepper
            value={bidAmount === "" ? undefined : bidAmount}
            onChange={(value) => setBidAmount(value ?? "")}
            min={0}
            step={1}
            prefix="$"
            width={110}
            size="md"
            label="max bid"
          />
          <Text size="xs" c="dimmed">
            Kept private - only the price needed to beat the next-highest bidder is ever shown.
          </Text>
        </Stack>
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            loading={submitting}
            disabled={!bidTeamId || bidAmount === ""}
          >
            Place Bid
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
