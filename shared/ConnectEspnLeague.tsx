import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Group,
  Radio,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "./errors";

// ESPN counterpart to ConnectSleeperLeague.tsx - same 2-step shape. Step 1
// differs: ESPN has no public username lookup (and no OAuth), so the user
// pastes their league ID or league page URL instead of picking from a list
// (convex/espn/league.ts's previewEspnImport parses either). Public leagues
// only for now - a private league comes back as a plain-language error
// explaining how to make it public. No ESPN-account concept to pre-select
// "which team is me", so that's always a manual pick here.
//
// draftType/salaryCap are throwaway filler, same as ConnectSleeperLeague's
// FILLER_* constants; scoring/teScoring/sixPointPassTds/rosterSlots/etc. are
// real values detected from ESPN.
const FILLER_SALARY_CAP = 200;

interface EspnImportTeam {
  teamId: string;
  teamName: string;
  ownerName: string | undefined;
}

interface ConnectEspnLeagueProps {
  onConnected: (seasonId: string) => void;
  onCancel: () => void;
}

export function ConnectEspnLeague({
  onConnected,
  onCancel,
}: ConnectEspnLeagueProps) {
  const previewEspnImport = useAction(api.espn.league.previewEspnImport);
  const createLeague = useMutation(api.leagues.createLeague);
  const initializeSeasonTeams = useMutation(
    api.infinileague.season.teams.initializeSeasonTeams,
  );
  const syncEspnLeagueRoster = useAction(api.espn.league.syncEspnLeagueRoster);

  const [leagueInput, setLeagueInput] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewEspnImport>
  > | null>(null);

  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [selfTeamId, setSelfTeamId] = useState("");

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleFindLeague = async () => {
    setLoadError(null);
    setLoadingPreview(true);
    try {
      const result = await previewEspnImport({ leagueInput });
      setPreview(result);
      setTeamNames(
        Object.fromEntries(
          result.teams.map((t: EspnImportTeam) => [t.teamId, t.teamName]),
        ),
      );
      setSelfTeamId(result.teams[0]?.teamId ?? "");
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load league."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConnect = async () => {
    if (!preview) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const seasonId = await createLeague({
        name: preview.name,
        teamCount: preview.teamCount,
        draftType: preview.draftType ?? "auction",
        salaryCap: FILLER_SALARY_CAP,
        scoring: preview.scoring,
        teScoring: preview.teScoring,
        sixPointPassTds: preview.sixPointPassTds,
        rosterSlots: preview.rosterSlots,
        flexPositions: preview.flexPositions,
        superflexPositions: preview.superflexPositions,
        espnLeagueId: preview.espnLeagueId,
      });

      const teams: EspnImportTeam[] = preview.teams;
      const selfTeam = teams.find((t) => t.teamId === selfTeamId);
      const opponents = teams.filter((t) => t.teamId !== selfTeamId);
      await initializeSeasonTeams({
        seasonId,
        selfName: (selfTeam ? teamNames[selfTeam.teamId] : undefined) ?? "Me",
        opponentNames: opponents.map((t) => teamNames[t.teamId] ?? t.teamName),
        ...(selfTeam ? { selfEspnTeamId: selfTeam.teamId } : {}),
        opponentEspnTeamIds: opponents.map((t) => t.teamId),
      });

      // Best-effort, same as ConnectSleeperLeague.tsx - the league page's
      // own staleness check retries on entry.
      try {
        await syncEspnLeagueRoster({ seasonId });
      } catch {
        // Swallowed - see comment above.
      }

      onConnected(seasonId);
    } catch (err) {
      setConnectError(getErrorMessage(err, "Failed to connect league."));
    } finally {
      setConnecting(false);
    }
  };

  if (!preview) {
    return (
      <Stack gap="md" py="sm" maw={500}>
        <Title order={4}>Connect an ESPN League</Title>
        <Text size="sm" c="dimmed">
          Paste your league's ESPN URL or its league ID. The league must be
          public (League Settings &gt; Basic Settings &gt; "Make League
          Viewable to Public").
        </Text>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            value={leagueInput}
            onChange={(e) => setLeagueInput(e.currentTarget.value)}
            placeholder="League URL or ID"
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => void handleFindLeague()}
            loading={loadingPreview}
            disabled={!leagueInput.trim()}
          >
            Find League
          </Button>
        </Group>
        {loadError && <Alert color="red">{loadError}</Alert>}
        <Group>
          <Button variant="subtle" onClick={onCancel}>
            Back
          </Button>
        </Group>
      </Stack>
    );
  }

  return (
    <Stack gap="lg" py="sm" maw={560}>
      <Title order={4}>Connect an ESPN League</Title>

      {preview.droppedSlots.length > 0 && (
        <Alert color="yellow">
          These roster slots don't have an equivalent here and were skipped:{" "}
          {preview.droppedSlots.join(", ")}. Your real roster may be larger.
        </Alert>
      )}

      <Card padding="md">
        <Stack gap="sm">
          <Text fw={500}>Which team is yours?</Text>
          <Radio.Group value={selfTeamId} onChange={setSelfTeamId}>
            <Stack gap={6}>
              {preview.teams.map((team: EspnImportTeam) => (
                <Group key={team.teamId} wrap="nowrap" gap="xs">
                  <Radio value={team.teamId} />
                  <TextInput
                    style={{ flex: 1 }}
                    value={teamNames[team.teamId] ?? team.teamName}
                    description={team.ownerName}
                    onChange={(e) =>
                      setTeamNames((current) => ({
                        ...current,
                        [team.teamId]: e.currentTarget.value,
                      }))
                    }
                  />
                </Group>
              ))}
            </Stack>
          </Radio.Group>
        </Stack>
      </Card>

      {connectError && <Alert color="red">{connectError}</Alert>}

      <Group>
        <Button onClick={() => void handleConnect()} loading={connecting}>
          Connect League
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={connecting}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
