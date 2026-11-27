import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { GenericId as Id } from "convex/values";
import { Alert, Button, Center, Loader, Radio, Stack, Text, TextInput, Title } from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "@shared/errors";
import glass from "@shared/glass/GlassMatchupCard.module.css";

export const Route = createFileRoute("/invite/$token")({
  component: InvitePage,
});

const WATCHING = "watching";

// The league link's landing page (convex/infiniyoffs/members.ts). The root
// auth gate has already signed the visitor in or up; here they pick their
// team - one nobody has claimed - or just watch. Someone already in the
// league goes straight to it.
function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const info = useQuery(api.infiniyoffs.members.getJoinInfo, { token });
  const joinLeague = useMutation(api.infiniyoffs.members.joinLeague);
  const [choice, setChoice] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyIn = info?.alreadyIn ?? false;
  const seasonId = info?.seasonId;
  useEffect(() => {
    if (alreadyIn && seasonId) {
      void navigate({ to: "/league/$leagueId", params: { leagueId: seasonId }, replace: true });
    }
  }, [alreadyIn, seasonId, navigate]);

  if (info === null) {
    return (
      <Center py="xl">
        <Alert color="red" title="Couldn't join this league" maw={420}>
          This invite link is no longer valid. Ask your commissioner for a new one.
        </Alert>
      </Center>
    );
  }
  if (info === undefined || info.alreadyIn) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const join = async () => {
    if (!choice) return;
    setJoining(true);
    setError(null);
    try {
      const { seasonId } = await joinLeague({
        token,
        teamId: choice === WATCHING ? null : (choice as Id<"seasonTeams">),
        ...(info.needsName ? { name } : {}),
      });
      await navigate({ to: "/league/$leagueId", params: { leagueId: seasonId }, replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Couldn't join the league."));
      setJoining(false);
    }
  };

  return (
    <Stack gap="md" maw={420} mx="auto" py="md">
      <Title order={3}>Join {info.leagueName}</Title>
      <div className={glass.card}>
        <Stack gap="md" p={4}>
          {info.needsName && (
            <TextInput
              label="Your name"
              description="Shown to your league's commissioner"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          )}
          <Radio.Group label="Which team is yours?" value={choice} onChange={setChoice}>
            <Stack gap="sm" mt="xs">
              {info.teams.map((team) => (
                <Radio
                  key={team.teamId}
                  value={team.teamId}
                  disabled={team.claimed}
                  label={team.name}
                  {...(team.claimed ? { description: "Claimed" } : {})}
                />
              ))}
              <Radio value={WATCHING} label="Just watching" />
            </Stack>
          </Radio.Group>
          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
          <Button
            onClick={() => void join()}
            loading={joining}
            disabled={!choice || (info.needsName && !name.trim())}
          >
            Join league
          </Button>
        </Stack>
      </div>
    </Stack>
  );
}
