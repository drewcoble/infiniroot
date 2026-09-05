import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Alert, Center, Loader, Stack } from "@mantine/core";
import { useMutation } from "convex/react";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";

export const Route = createFileRoute("/join/$token")({
  component: JoinPage,
});

// __root.tsx's own auth gate already shows AuthPanel for a signed-out
// visitor on ANY route, this one included - so by the time this component
// actually renders, the visitor is authenticated and all that's left is to
// redeem the invite and land them on the season's auction. No manual "sign
// in first" branching needed here.
function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const redeemTeamInvite = useMutation(api.infinileague.auction.invites.redeemTeamInvite);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { seasonId } = await redeemTeamInvite({ token });
        if (!cancelled) {
          await navigate({
            to: "/league/$leagueId",
            params: { leagueId: seasonId },
            replace: true,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err, "Failed to redeem this invite link."));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run if the token itself changes - redeemTeamInvite/navigate
    // are stable Convex/router-provided callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (error) {
    return (
      <Center py="xl">
        <Alert color="red" title="Couldn't join this team" maw={420}>
          {error}
        </Alert>
      </Center>
    );
  }

  return (
    <Center py="xl">
      <Stack align="center" gap="sm">
        <Loader />
      </Stack>
    </Center>
  );
}
