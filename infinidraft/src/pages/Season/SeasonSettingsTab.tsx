import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { RefreshCw } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import { EditableNumberStepper } from "../../components/NumberStepper";
import { getErrorMessage } from "@shared/errors";

interface SeasonSettingsTabProps {
  seasonId: Id<"seasons">;
}

interface TeamOption {
  key: string;
  label: string;
}

type Provider = "sleeper" | "yahoo";

// One-time-per-season setup for in-season tooling: link this league to a
// real Sleeper or Yahoo league, map each app team to a real roster/team, set
// the league's FAAB pool, and sync rosters/spend on demand - see the plan
// doc ("In-Season Tooling: FAAB Bid Value Calculator") for why this stays
// manually-triggered rather than a background cron for v1, and Part 3 for
// why Yahoo needs the extra "Connect Yahoo Account" OAuth step Sleeper
// doesn't (see YAHOO.md at the project root for what that step depends on).
export function SeasonSettingsTab({ seasonId }: SeasonSettingsTabProps) {
  const settingsList = useQuery(api.leagues.listSeasons, {});
  const settings = settingsList?.find((s) => s._id === seasonId);
  const teams = useQuery(api.infinidraft.draft.teams.listSeasonTeams, { seasonId });
  const yahooStatus = useQuery(api.infinidraft.yahoo.oauth.getConnectionStatus, {});

  const setSleeperLeagueId = useMutation(api.leagues.setSleeperLeagueId);
  const setYahooLeagueKey = useMutation(api.leagues.setYahooLeagueKey);
  const setFaabBudget = useMutation(api.leagues.setFaabBudget);
  const setTeamSleeperLink = useMutation(api.infinidraft.draft.teams.setTeamSleeperLink);
  const setTeamYahooLink = useMutation(api.infinidraft.draft.teams.setTeamYahooLink);
  const fetchSleeperLeagueTeams = useAction(
    api.sleeper.league.fetchSleeperLeagueTeams,
  );
  const listSleeperLeaguesForUsername = useAction(
    api.sleeper.league.listSleeperLeaguesForUsername,
  );
  const syncLeagueRoster = useAction(api.sleeper.league.syncLeagueRoster);
  const startYahooAuth = useAction(api.infinidraft.yahoo.oauth.startYahooAuth);
  const listMyYahooLeagues = useAction(api.infinidraft.yahoo.league.listMyYahooLeagues);
  const fetchYahooLeagueTeams = useAction(api.infinidraft.yahoo.league.fetchYahooLeagueTeams);
  const syncYahooLeagueRoster = useAction(api.infinidraft.yahoo.league.syncYahooLeagueRoster);

  const [provider, setProvider] = useState<Provider>("sleeper");
  const [sleeperUsernameInput, setSleeperUsernameInput] = useState("");
  const [sleeperUserId, setSleeperUserId] = useState<string | null>(null);
  const [sleeperLeagues, setSleeperLeagues] = useState<
    Array<{ leagueId: string; name: string; season: string }> | null
  >(null);
  const [loadingSleeperLeagues, setLoadingSleeperLeagues] = useState(false);
  const [faabBudgetInput, setFaabBudgetInput] = useState<number | undefined>(
    undefined,
  );
  const [teamOptions, setTeamOptions] = useState<TeamOption[] | null>(null);
  const [teamKeyToOwner, setTeamKeyToOwner] = useState<Record<string, string>>({});
  const [yahooLeagues, setYahooLeagues] = useState<
    Array<{ leagueKey: string; name: string }> | null
  >(null);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [loadingYahooLeagues, setLoadingYahooLeagues] = useState(false);
  const [connectingYahoo, setConnectingYahoo] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setProvider(settings?.yahooLeagueKey ? "yahoo" : "sleeper");
  }, [settings?.yahooLeagueKey, settings?.sleeperLeagueId]);

  useEffect(() => {
    setFaabBudgetInput(settings?.faabBudget);
  }, [settings?.faabBudget]);

  // Yahoo's OAuth callback (convex/http.ts's /yahoo/callback) redirects back
  // here with ?yahooConnected=1 or ?yahooError=... - surface that once, then
  // clean the URL so a refresh doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const yahooError = params.get("yahooError");
    const yahooConnected = params.get("yahooConnected");
    if (yahooError) {
      setError(`Yahoo connection failed: ${yahooError}`);
      window.history.replaceState(null, "", window.location.pathname);
    } else if (yahooConnected) {
      setStatus("Yahoo account connected.");
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (!settings || teams === undefined) {
    return null;
  }

  const handleFindSleeperLeagues = async () => {
    setError(null);
    setStatus(null);
    setLoadingSleeperLeagues(true);
    try {
      const result = await listSleeperLeaguesForUsername({
        username: sleeperUsernameInput.trim(),
      });
      setSleeperUserId(result.sleeperUserId);
      setSleeperLeagues(result.leagues);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to find leagues."));
    } finally {
      setLoadingSleeperLeagues(false);
    }
  };

  const handleSelectSleeperLeague = async (leagueId: string | null) => {
    setError(null);
    try {
      await setSleeperLeagueId({ id: seasonId, sleeperLeagueId: leagueId });
      setTeamOptions(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save."));
    }
  };

  const handleSaveFaabBudget = async () => {
    setError(null);
    try {
      await setFaabBudget({
        id: seasonId,
        faabBudget: faabBudgetInput === undefined ? null : faabBudgetInput,
      });
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save."));
    }
  };

  const handleLoadSleeperTeams = async () => {
    if (!settings.sleeperLeagueId) return;
    setError(null);
    setStatus(null);
    setLoadingTeams(true);
    try {
      const result = await fetchSleeperLeagueTeams({
        sleeperLeagueId: settings.sleeperLeagueId,
      });
      setTeamOptions(result.map((t) => ({ key: t.rosterId, label: t.teamName })));
      setTeamKeyToOwner(
        Object.fromEntries(result.map((t) => [t.rosterId, t.ownerId])),
      );

      // Auto-map "me" using the Sleeper user_id resolved by the username
      // lookup above, so the self team doesn't need a manual pick when we
      // already know which roster is theirs.
      if (sleeperUserId) {
        const selfTeam = teams.find((t) => t.isSelf);
        const matchedRoster = result.find((t) => t.ownerId === sleeperUserId);
        if (selfTeam && matchedRoster && !selfTeam.sleeperRosterId) {
          await setTeamSleeperLink({
            teamId: selfTeam._id,
            sleeperRosterId: matchedRoster.rosterId,
            sleeperOwnerId: matchedRoster.ownerId,
          });
        }
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load teams."));
    } finally {
      setLoadingTeams(false);
    }
  };

  const handleConnectYahoo = async () => {
    setError(null);
    setConnectingYahoo(true);
    try {
      const { authorizeUrl } = await startYahooAuth({ seasonId });
      window.location.href = authorizeUrl;
    } catch (err) {
      setError(
        getErrorMessage(err, "Failed to start Yahoo connect."),
      );
      setConnectingYahoo(false);
    }
  };

  const handleLoadYahooLeagues = async () => {
    setError(null);
    setStatus(null);
    setLoadingYahooLeagues(true);
    try {
      const result = await listMyYahooLeagues({});
      setYahooLeagues(result);
    } catch (err) {
      setError(
        getErrorMessage(err, "Failed to load Yahoo leagues."),
      );
    } finally {
      setLoadingYahooLeagues(false);
    }
  };

  const handleSaveYahooLeagueKey = async (leagueKey: string | null) => {
    setError(null);
    try {
      await setYahooLeagueKey({ id: seasonId, yahooLeagueKey: leagueKey });
      setTeamOptions(null);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to save."));
    }
  };

  const handleLoadYahooTeams = async () => {
    if (!settings.yahooLeagueKey) return;
    setError(null);
    setStatus(null);
    setLoadingTeams(true);
    try {
      const result = await fetchYahooLeagueTeams({
        leagueKey: settings.yahooLeagueKey,
      });
      setTeamOptions(
        result.map((t) => ({
          key: t.teamKey,
          label: `${t.teamName} (${t.managerName})`,
        })),
      );
    } catch (err) {
      setError(getErrorMessage(err, "Failed to load teams."));
    } finally {
      setLoadingTeams(false);
    }
  };

  const handleMapTeam = async (teamId: Id<"seasonTeams">, key: string | null) => {
    setError(null);
    try {
      if (provider === "sleeper") {
        await setTeamSleeperLink({
          teamId,
          sleeperRosterId: key,
          sleeperOwnerId: key ? (teamKeyToOwner[key] ?? key) : null,
        });
      } else {
        await setTeamYahooLink({ teamId, yahooTeamKey: key });
      }
    } catch (err) {
      setError(getErrorMessage(err, "Failed to map team."));
    }
  };

  const handleSync = async () => {
    setError(null);
    setStatus(null);
    setSyncing(true);
    try {
      const result =
        provider === "sleeper"
          ? await syncLeagueRoster({ seasonId })
          : await syncYahooLeagueRoster({ seasonId });
      setStatus(
        `Synced ${result.syncedTeams} team${result.syncedTeams === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setError(getErrorMessage(err, "Sync failed."));
    } finally {
      setSyncing(false);
    }
  };

  const linkedTeamKey = (team: (typeof teams)[number]) =>
    provider === "sleeper" ? team.sleeperRosterId : team.yahooTeamKey;
  const mappedCount = teams.filter((t) => linkedTeamKey(t)).length;
  const isLinked =
    provider === "sleeper" ? !!settings.sleeperLeagueId : !!settings.yahooLeagueKey;
  const canSync =
    provider === "sleeper"
      ? !!settings.sleeperLeagueId
      : !!settings.yahooLeagueKey;

  return (
    <Stack gap="lg" maw={640}>
      <Title order={3}>In-Season Settings</Title>

      <SegmentedControl
        value={provider}
        onChange={(value) => setProvider(value as Provider)}
        data={[
          { label: "Sleeper", value: "sleeper" },
          { label: "Yahoo", value: "yahoo" },
        ]}
      />

      {provider === "sleeper" ? (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text fw={500}>Sleeper league</Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput
                value={sleeperUsernameInput}
                onChange={(e) => setSleeperUsernameInput(e.currentTarget.value)}
                placeholder="Sleeper username"
                style={{ flex: 1 }}
              />
              <Button
                onClick={() => void handleFindSleeperLeagues()}
                loading={loadingSleeperLeagues}
                disabled={!sleeperUsernameInput.trim()}
              >
                Find Leagues
              </Button>
            </Group>
            {sleeperLeagues && (
              <Select
                placeholder="Select a league"
                value={settings.sleeperLeagueId ?? null}
                data={sleeperLeagues.map((l) => ({
                  value: l.leagueId,
                  label: `${l.name} (${l.season})`,
                }))}
                onChange={(value) => void handleSelectSleeperLeague(value)}
              />
            )}
            {settings.sleeperLeagueId && (
              <>
                <Text size="xs" c="dimmed">
                  Linked league id: {settings.sleeperLeagueId}
                </Text>
                <Button
                  variant="default"
                  onClick={() => void handleLoadSleeperTeams()}
                  loading={loadingTeams}
                  w="fit-content"
                >
                  Load Sleeper teams
                </Button>
              </>
            )}
          </Stack>
        </Card>
      ) : (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Text fw={500}>Yahoo league</Text>
            {!yahooStatus?.connected ? (
              <>
                <Button
                  onClick={() => void handleConnectYahoo()}
                  loading={connectingYahoo}
                  w="fit-content"
                >
                  Connect Yahoo Account
                </Button>
              </>
            ) : (
              <>
                <Badge variant="light" color="teal" w="fit-content">
                  Yahoo account connected
                </Badge>
                <Button
                  variant="default"
                  onClick={() => void handleLoadYahooLeagues()}
                  loading={loadingYahooLeagues}
                  w="fit-content"
                >
                  Load Yahoo leagues
                </Button>
                {yahooLeagues && (
                  <Select
                    placeholder="Select a league"
                    value={settings.yahooLeagueKey ?? null}
                    data={yahooLeagues.map((l) => ({
                      value: l.leagueKey,
                      label: l.name,
                    }))}
                    onChange={(value) => void handleSaveYahooLeagueKey(value)}
                  />
                )}
                {settings.yahooLeagueKey && (
                  <Button
                    variant="default"
                    onClick={() => void handleLoadYahooTeams()}
                    loading={loadingTeams}
                    w="fit-content"
                  >
                    Load Yahoo teams
                  </Button>
                )}
              </>
            )}
          </Stack>
        </Card>
      )}

      {isLinked && (
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={500}>Map teams</Text>
              <Badge variant="light" color={mappedCount === teams.length ? "teal" : "yellow"}>
                {mappedCount}/{teams.length} mapped
              </Badge>
            </Group>
            {teamOptions === null ? (
              <Text size="sm" c="dimmed">
                Click "Load {provider === "sleeper" ? "Sleeper" : "Yahoo"} teams" above to see options.
              </Text>
            ) : (
              <Stack gap={6}>
                {teams.map((team) => (
                  <Group key={team._id} justify="space-between" wrap="nowrap">
                    <Text size="sm" style={{ flex: 1 }} truncate>
                      {team.name}
                      {team.isSelf && (
                        <Text component="span" c="dimmed" size="xs">
                          {" "}
                          (you)
                        </Text>
                      )}
                    </Text>
                    <Select
                      size="sm"
                      w={220}
                      clearable
                      placeholder="Unmapped"
                      value={linkedTeamKey(team) ?? null}
                      data={teamOptions.map((t) => ({
                        value: t.key,
                        label: t.label,
                      }))}
                      onChange={(value) => void handleMapTeam(team._id, value)}
                    />
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md">
        <Stack gap="sm">
          <Text fw={500}>FAAB budget</Text>
          <Group gap="xs" wrap="nowrap">
            <EditableNumberStepper
              label="FAAB budget"
              value={faabBudgetInput}
              onChange={setFaabBudgetInput}
              prefix="$"
              min={0}
              width={140}
              nullable
            />
            <Button
              onClick={() => void handleSaveFaabBudget()}
              disabled={faabBudgetInput === settings.faabBudget}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Card>

      <Group>
        <Button
          leftSection={<RefreshCw size={16} />}
          onClick={() => void handleSync()}
          loading={syncing}
          disabled={!canSync || mappedCount === 0}
        >
          Sync Roster & FAAB Now
        </Button>
      </Group>

      {status && <Alert color="teal">{status}</Alert>}
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  );
}
