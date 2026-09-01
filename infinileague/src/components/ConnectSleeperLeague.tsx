import { useState } from "react";
import { useAction, useMutation } from "convex/react";
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
import { getErrorMessage } from "@shared/errors";

// Trimmed 2-step version of infinidraft's LeagueImportWizard.tsx (~320
// lines there, built around a full draft-settings review form and a
// keeper-history import - both meaningless here, since infinileague never
// runs a draft). Step 1: find Sleeper leagues by username, pick one. Step 2:
// pick which Sleeper team is "me", optionally rename teams, connect.
//
// draftType/salaryCap below are throwaway filler - createLeague requires
// them (its `seasons` row always has them), but infinileague never displays
// or reads either field back. `scoring`/`rosterSlots`/etc, by contrast, are
// the real detected values from Sleeper and matter - they feed the value
// math this app is for.
const FILLER_SALARY_CAP = 200;
const FILLER_TE_SCORING = "NONE";
const FILLER_SIX_POINT_PASS_TDS = false;

interface SleeperLeagueOption {
  leagueId: string;
  name: string;
  season: string;
}

interface SleeperImportTeam {
  rosterId: string;
  ownerId: string;
  teamName: string;
}

interface SleeperImportPreview {
  name: string;
  teamCount: number;
  draftType: "auction" | "snake" | "linear" | undefined;
  scoring: "STD" | "HALF" | "PPR";
  // No teScoring/sixPointPassTds here - confirmed live that
  // previewSleeperImport doesn't return either (Sleeper's TE-premium/
  // passing-TD settings aren't mapped yet, per convex/sleeper/
  // leagueSettingsMapping.ts) - infinidraft's own LeagueImportWizard.tsx
  // falls back to DEFAULT_FORM's "NONE"/false for the same reason, which
  // is what FILLER_TE_SCORING/FILLER_SIX_POINT_PASS_TDS below mirror.
  rosterSlots: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    DST: number;
    K: number;
    FLEX: number;
    SUPERFLEX: number;
    BENCH: number;
  };
  flexPositions: Array<"QB" | "RB" | "WR" | "TE" | "DST" | "K">;
  superflexPositions: Array<"QB" | "RB" | "WR" | "TE" | "DST" | "K">;
  teams: SleeperImportTeam[];
}

interface ConnectSleeperLeagueProps {
  onConnected: (seasonId: string) => void;
  onCancel: () => void;
}

export function ConnectSleeperLeague({
  onConnected,
  onCancel,
}: ConnectSleeperLeagueProps) {
  const listSleeperLeaguesForUsername = useAction(
    api.sleeper.league.listSleeperLeaguesForUsername,
  );
  const previewSleeperImport = useAction(api.sleeper.league.previewSleeperImport);
  const createLeague = useMutation(api.leagues.createLeague);
  const initializeSeasonTeams = useMutation(api.draft.teams.initializeSeasonTeams);
  const syncLeagueRoster = useAction(api.sleeper.league.syncLeagueRoster);

  const [usernameInput, setUsernameInput] = useState("");
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  const [leagueOptions, setLeagueOptions] = useState<SleeperLeagueOption[] | null>(
    null,
  );
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SleeperImportPreview | null>(null);

  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [selfOwnerId, setSelfOwnerId] = useState("");

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const handleFindLeagues = async () => {
    setLoadError(null);
    setLoadingLeagues(true);
    try {
      const result = await listSleeperLeaguesForUsername({
        username: usernameInput.trim(),
      });
      setSleeperUserId(result.sleeperUserId);
      setLeagueOptions(result.leagues);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to find leagues."));
    } finally {
      setLoadingLeagues(false);
    }
  };

  const handleSelectLeague = async (leagueId: string | null) => {
    setSelectedLeagueId(leagueId);
    if (!leagueId) return;
    setLoadError(null);
    setLoadingPreview(true);
    try {
      const result: SleeperImportPreview = await previewSleeperImport({
        sleeperLeagueId: leagueId,
      });
      setPreview(result);
      setTeamNames(
        Object.fromEntries(result.teams.map((t) => [t.rosterId, t.teamName])),
      );
      setSelfOwnerId(
        sleeperUserId && result.teams.some((t) => t.ownerId === sleeperUserId)
          ? sleeperUserId
          : (result.teams[0]?.ownerId ?? ""),
      );
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load league."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleConnect = async () => {
    if (!preview || !selectedLeagueId) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const seasonId = await createLeague({
        name: preview.name,
        teamCount: preview.teamCount,
        draftType: preview.draftType ?? "auction",
        salaryCap: FILLER_SALARY_CAP,
        scoring: preview.scoring,
        teScoring: FILLER_TE_SCORING,
        sixPointPassTds: FILLER_SIX_POINT_PASS_TDS,
        rosterSlots: preview.rosterSlots,
        flexPositions: preview.flexPositions,
        superflexPositions: preview.superflexPositions,
        sleeperLeagueId: selectedLeagueId,
      });

      const selfTeam = preview.teams.find((t) => t.ownerId === selfOwnerId);
      const opponents = preview.teams.filter((t) => t.ownerId !== selfOwnerId);
      await initializeSeasonTeams({
        seasonId,
        selfName: (selfTeam ? teamNames[selfTeam.rosterId] : undefined) ?? "Me",
        opponentNames: opponents.map((t) => teamNames[t.rosterId] ?? t.teamName),
        ...(selfTeam
          ? {
              selfSleeperLink: {
                sleeperRosterId: selfTeam.rosterId,
                sleeperOwnerId: selfTeam.ownerId,
              },
            }
          : {}),
        opponentSleeperLinks: opponents.map((t) => ({
          sleeperRosterId: t.rosterId,
          sleeperOwnerId: t.ownerId,
        })),
      });

      // Best-effort - a failed first sync shouldn't block getting into the
      // new league; the league page's own staleness check (empty
      // getRosterSyncStatus) will just trigger another attempt on entry.
      try {
        await syncLeagueRoster({ seasonId });
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
        <Title order={4}>Connect a Sleeper League</Title>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.currentTarget.value)}
            placeholder="Sleeper username"
            style={{ flex: 1 }}
          />
          <Button
            onClick={() => void handleFindLeagues()}
            loading={loadingLeagues}
            disabled={!usernameInput.trim()}
          >
            Find Leagues
          </Button>
        </Group>
        {leagueOptions && (
          <Select
            placeholder="Select a league"
            value={selectedLeagueId}
            data={leagueOptions.map((l) => ({
              value: l.leagueId,
              label: `${l.name} (${l.season})`,
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
      <Title order={4}>Connect a Sleeper League</Title>

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text fw={500}>Which team is yours?</Text>
          <Radio.Group value={selfOwnerId} onChange={setSelfOwnerId}>
            <Stack gap={6}>
              {preview.teams.map((team) => (
                <Group key={team.rosterId} wrap="nowrap" gap="xs">
                  <Radio value={team.ownerId} />
                  <TextInput
                    style={{ flex: 1 }}
                    value={teamNames[team.rosterId] ?? team.teamName}
                    onChange={(e) =>
                      setTeamNames((current) => ({
                        ...current,
                        [team.rosterId]: e.currentTarget.value,
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
