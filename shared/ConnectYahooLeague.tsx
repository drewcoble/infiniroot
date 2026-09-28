import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Alert,
  Button,
  Card,
  Group,
  Loader,
  Radio,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { api } from "@infinidata/api";
import { getErrorMessage } from "./errors";

// Trimmed rewrite of infinidraft's YahooLeagueImportWizard.tsx (~330 lines
// there, built around a full draft-settings review form and a keeper-
// history import - both meaningless here, same reasoning as
// ConnectSleeperLeague.tsx's trimming of infinidraft's Sleeper wizard.
// Unlike Sleeper, Yahoo needs an OAuth-connect step first (every Yahoo API
// call needs a token scoped to a signed-in Yahoo account) - see
// convex/infinidraft/yahoo/oauth.ts.
//
// draftType/salaryCap below are throwaway filler, same rationale as
// ConnectSleeperLeague.tsx's FILLER_* constants. scoring/teScoring/
// sixPointPassTds/rosterSlots/flexPositions/superflexPositions/leagueType
// are real values detected from Yahoo (previewYahooImport returns
// teScoring/sixPointPassTds directly, unlike Sleeper's preview) and matter -
// they feed the value math these apps are for.
const FILLER_SALARY_CAP = 200;

interface ConnectYahooLeagueProps {
  app: "infinileague" | "infinifaab";
  onConnected: (seasonId: string) => void;
  onCancel: () => void;
}

export function ConnectYahooLeague({
  app,
  onConnected,
  onCancel,
}: ConnectYahooLeagueProps) {
  const yahooStatus = useQuery(api.infinidraft.yahoo.oauth.getConnectionStatus, {});
  const startYahooAuth = useAction(api.infinidraft.yahoo.oauth.startYahooAuth);
  const listMyYahooLeagues = useAction(api.infinidraft.yahoo.league.listMyYahooLeagues);
  const previewYahooImport = useAction(api.infinidraft.yahoo.league.previewYahooImport);
  const createLeague = useMutation(api.leagues.createLeague);
  const initializeSeasonTeams = useMutation(
    api.infinileague.season.teams.initializeSeasonTeams,
  );
  const syncYahooLeagueRoster = useAction(
    api.infinidraft.yahoo.league.syncYahooLeagueRoster,
  );

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [leagueOptions, setLeagueOptions] = useState<Array<{
    leagueKey: string;
    name: string;
  }> | null>(null);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [selectedLeagueKey, setSelectedLeagueKey] = useState<string | null>(
    null,
  );
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewYahooImport>
  > | null>(null);

  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [selfTeamKey, setSelfTeamKey] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      // No seasonId to redirect back to - this league doesn't exist yet.
      // The OAuth round trip lands back on "/" (see convex/http.ts's
      // yahooRedirectTarget), so this wizard's in-progress state is lost;
      // the user re-opens "Import from Yahoo" afterward - same limitation
      // infinidraft's own wizard already accepts.
      const { authorizeUrl } = await startYahooAuth({ app });
      window.location.href = authorizeUrl;
    } catch (err) {
      setConnectError(getErrorMessage(err, "Failed to start Yahoo connect."));
      setConnecting(false);
    }
  };

  const handleFindLeagues = async () => {
    setLoadError(null);
    setLoadingLeagues(true);
    try {
      const result = await listMyYahooLeagues({});
      setLeagueOptions(result);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load leagues."));
    } finally {
      setLoadingLeagues(false);
    }
  };

  const handleSelectLeague = async (leagueKey: string | null) => {
    setSelectedLeagueKey(leagueKey);
    if (!leagueKey) return;
    setLoadError(null);
    setLoadingPreview(true);
    try {
      const result = await previewYahooImport({ leagueKey });
      setPreview(result);
      setTeamNames(
        Object.fromEntries(result.teams.map((t) => [t.teamKey, t.teamName])),
      );
      const currentUserTeam = result.teams.find((t) => t.isCurrentUser);
      setSelfTeamKey(
        currentUserTeam?.teamKey ?? result.teams[0]?.teamKey ?? "",
      );
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load league."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConnectLeague = async () => {
    if (!preview || !selectedLeagueKey) return;
    setSaving(true);
    setSaveError(null);
    try {
      const seasonId = await createLeague({
        name: preview.name,
        teamCount: preview.teamCount,
        // Yahoo import never detects draft type (SNAKE_DRAFT.md §6) - same
        // as infinidraft's own wizard, not shown/read back here anyway.
        draftType: "auction",
        leagueType: preview.leagueType,
        salaryCap: FILLER_SALARY_CAP,
        scoring: preview.scoring,
        teScoring: preview.teScoring,
        sixPointPassTds: preview.sixPointPassTds,
        rosterSlots: preview.rosterSlots,
        flexPositions: preview.flexPositions,
        superflexPositions: preview.superflexPositions,
        yahooLeagueKey: selectedLeagueKey,
      });

      const selfTeam = preview.teams.find((t) => t.teamKey === selfTeamKey);
      const opponents = preview.teams.filter((t) => t.teamKey !== selfTeamKey);
      await initializeSeasonTeams({
        seasonId,
        selfName: (selfTeam ? teamNames[selfTeam.teamKey] : undefined) ?? "Me",
        opponentNames: opponents.map((t) => teamNames[t.teamKey] ?? t.teamName),
        ...(selfTeam ? { selfYahooTeamKey: selfTeam.teamKey } : {}),
        opponentYahooTeamKeys: opponents.map((t) => t.teamKey),
      });

      // Best-effort - a failed first sync shouldn't block getting into the
      // new league; the league page's own staleness check will just
      // trigger another attempt on entry (same as ConnectSleeperLeague.tsx).
      try {
        await syncYahooLeagueRoster({ seasonId });
      } catch {
        // Swallowed - see comment above.
      }

      onConnected(seasonId);
    } catch (err) {
      setSaveError(getErrorMessage(err, "Failed to connect league."));
    } finally {
      setSaving(false);
    }
  };

  if (yahooStatus === undefined) {
    return (
      <Stack align="center" py="xl">
        <Loader />
      </Stack>
    );
  }

  if (!yahooStatus.connected) {
    return (
      <Stack gap="md" py="sm" maw={500}>
        <Title order={4}>Import from Yahoo</Title>
        {connectError && <Alert color="red">{connectError}</Alert>}
        <Group>
          <Button onClick={() => void handleConnect()} loading={connecting}>
            Connect Yahoo Account
          </Button>
          <Button variant="subtle" onClick={onCancel}>
            Back
          </Button>
        </Group>
      </Stack>
    );
  }

  if (!preview) {
    return (
      <Stack gap="md" py="sm" maw={500}>
        <Title order={4}>Import from Yahoo</Title>
        <Group>
          <Button
            onClick={() => void handleFindLeagues()}
            loading={loadingLeagues}
          >
            Load my leagues
          </Button>
        </Group>
        {leagueOptions && (
          <Select
            placeholder="Select a league"
            value={selectedLeagueKey}
            data={leagueOptions.map((l) => ({
              value: l.leagueKey,
              label: l.name,
            }))}
            onChange={(value) => void handleSelectLeague(value)}
          />
        )}
        {loadingPreview && <Loader size="sm" />}
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
      <Title order={4}>Import from Yahoo</Title>

      {preview.droppedSlots.length > 0 && (
        <Alert color="yellow">
          These roster slots don't have an equivalent here and were skipped:{" "}
          {preview.droppedSlots.join(", ")}. Your real roster may be larger.
        </Alert>
      )}

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text fw={500}>Which team is yours?</Text>
          <Radio.Group value={selfTeamKey} onChange={setSelfTeamKey}>
            <Stack gap={6}>
              {preview.teams.map((team) => (
                <Group key={team.teamKey} wrap="nowrap" gap="xs">
                  <Radio value={team.teamKey} />
                  <TextInput
                    style={{ flex: 1 }}
                    value={teamNames[team.teamKey] ?? team.teamName}
                    onChange={(e) =>
                      setTeamNames((current) => ({
                        ...current,
                        [team.teamKey]: e.currentTarget.value,
                      }))
                    }
                  />
                </Group>
              ))}
            </Stack>
          </Radio.Group>
        </Stack>
      </Card>

      {saveError && <Alert color="red">{saveError}</Alert>}

      <Group>
        <Button onClick={() => void handleConnectLeague()} loading={saving}>
          Connect League
        </Button>
        <Button variant="subtle" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
