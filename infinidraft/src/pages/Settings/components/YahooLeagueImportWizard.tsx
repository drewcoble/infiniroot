import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
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
import type { Id } from "@infinidata/dataModel";
import {
  DEFAULT_FORM,
  type LeagueSettingsFormValues,
} from "../../../constants/leagueSettings";
import { SettingsForm } from "./SettingsForm";
import { getErrorMessage } from "@shared/errors";
import { SNAKE_DRAFT_ENABLED } from "../../../lib/featureFlags";

interface YahooLeagueImportWizardProps {
  onImported: (id: Id<"seasons">) => void;
  onCancel: () => void;
}

// Yahoo counterpart to LeagueImportWizard.tsx - same three-step shape (pick
// a real league, review/edit the mapped settings + team names/self-
// selection, optional prior-season keeper import) but fronted by a
// "connect your Yahoo account first" step, since (unlike Sleeper) every
// Yahoo API call needs an OAuth token (see convex/yahoo/oauth.ts). Team/
// scoring mapping (convex/yahoo/leagueSettingsMapping.ts) and the whole
// prior-season keeper-price chain (convex/yahoo/league.ts's
// previewYahooImport) are unverified against a real live league - see
// YAHOO.md.
export function YahooLeagueImportWizard({
  onImported,
  onCancel,
}: YahooLeagueImportWizardProps) {
  const yahooStatus = useQuery(api.infinidraft.yahoo.oauth.getConnectionStatus, {});
  const startYahooAuth = useAction(api.infinidraft.yahoo.oauth.startYahooAuth);
  const listMyYahooLeagues = useAction(api.infinidraft.yahoo.league.listMyYahooLeagues);
  const previewYahooImport = useAction(api.infinidraft.yahoo.league.previewYahooImport);
  const createLeague = useMutation(api.leagues.createLeague);
  const initializeSeasonTeams = useMutation(
    api.infinidraft.draft.teams.initializeSeasonTeams,
  );
  const importHistory = useMutation(api.leagues.importPreviousSeasonHistory);

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
  const [importKeeperHistory, setImportKeeperHistory] = useState(true);
  const [form, setForm] = useState<LeagueSettingsFormValues>(DEFAULT_FORM);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnectError(null);
    setConnecting(true);
    try {
      // No seasonId to redirect back to - this league doesn't exist yet.
      // The OAuth round trip lands back on "/" (see convex/http.ts's
      // yahooRedirectTarget), so the wizard's in-progress state is lost;
      // the user re-opens "+ New League > Import from Yahoo" afterward,
      // same limitation noted in the UI below.
      const { authorizeUrl } = await startYahooAuth({});
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
      setForm({
        name: result.name,
        teamCount: result.teamCount,
        // previewYahooImport doesn't detect the linked league's own draft
        // type yet (SNAKE_DRAFT.md §6 - only the previous season's is ever
        // looked at, and only to seed keeper price history) - defaults to
        // auction same as every import today, adjustable after import.
        draftType: DEFAULT_FORM.draftType,
        salaryCap: DEFAULT_FORM.salaryCap,
        scoring: result.scoring,
        // Yahoo's TE-premium/passing-TD settings aren't mapped yet (see
        // convex/yahoo/leagueSettingsMapping.ts) - default off, same as a
        // brand-new custom league, and the owner can adjust after import if
        // their real league differs.
        teScoring: DEFAULT_FORM.teScoring,
        sixPointPassTds: DEFAULT_FORM.sixPointPassTds,
        rosterSlots: result.rosterSlots,
        flexPositions: result.flexPositions,
        superflexPositions: result.superflexPositions,
        useKeepers: DEFAULT_FORM.useKeepers,
      });
    } catch (err) {
      setLoadError(getErrorMessage(err, "Failed to load league."));
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleCreate = async () => {
    if (!preview || !selectedLeagueKey) return;
    setSaving(true);
    setSaveError(null);
    try {
      const newId = await createLeague({
        name: form.name,
        teamCount: form.teamCount,
        // Clamped at the actual write path - see LeagueImportWizard.tsx's
        // matching comment (Yahoo draft-type detection isn't built either).
        draftType: SNAKE_DRAFT_ENABLED ? form.draftType : "auction",
        salaryCap: form.salaryCap,
        scoring: form.scoring,
        teScoring: form.teScoring,
        sixPointPassTds: form.sixPointPassTds,
        rosterSlots: form.rosterSlots,
        flexPositions: form.flexPositions,
        superflexPositions: form.superflexPositions,
        yahooLeagueKey: selectedLeagueKey,
      });

      const selfTeam = preview.teams.find((t) => t.teamKey === selfTeamKey);
      const opponents = preview.teams.filter((t) => t.teamKey !== selfTeamKey);
      await initializeSeasonTeams({
        seasonId: newId,
        selfName: (selfTeam ? teamNames[selfTeam.teamKey] : undefined) ?? "Me",
        opponentNames: opponents.map((t) => teamNames[t.teamKey] ?? t.teamName),
        ...(selfTeam ? { selfYahooTeamKey: selfTeam.teamKey } : {}),
        opponentYahooTeamKeys: opponents.map((t) => t.teamKey),
      });

      if (importKeeperHistory && preview.previousSeason) {
        await importHistory({
          newSeasonId: newId,
          season: preview.previousSeason.season,
          yahooLeagueKey: selectedLeagueKey,
          ...(selfTeamKey ? { selfOwnerId: selfTeamKey } : {}),
          teams: preview.previousSeason.teams.map((t) => ({
            ownerId: t.ownerId,
            teamName: t.teamName,
            players: t.players.map((p) => ({
              fpid: p.fpid,
              ...(p.price !== undefined ? { price: p.price } : {}),
            })),
          })),
        });
      }

      onImported(newId);
    } catch (err) {
      setSaveError(getErrorMessage(err, "Failed to import league."));
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
          <Text fw={500}>Teams</Text>
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

      {preview.previousSeason && (
        <Checkbox
          label={`Also import ${preview.previousSeason.season}'s roster for keeper suggestions${
            preview.previousSeason.isAuction
              ? ""
              : " (no auction prices found - eligibility only)"
          }`}
          checked={importKeeperHistory}
          onChange={(e) => setImportKeeperHistory(e.currentTarget.checked)}
        />
      )}

      <SettingsForm
        form={form}
        onChange={setForm}
        error={saveError}
        isSaving={saving}
        onSave={() => void handleCreate()}
        onCancel={onCancel}
        saveLabel="Create League"
        compact
      />
      <Badge variant="light" color="yellow" w="fit-content">
        Yahoo import is unverified against a real league - see YAHOO.md
      </Badge>
    </Stack>
  );
}
