import { v } from "convex/values";
import { action, internalQuery, type ActionCtx, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { fetchYahooApi, mergeYahooFields, findNodesByKey } from "./client";
import { withYahooToken } from "./oauth";
import {
  mapYahooRosterPositions,
  mapYahooScoringSettings,
  type MappedRosterSlots,
} from "./leagueSettingsMapping";
import type { Scoring } from "../scoring";

export const listMyYahooLeagues = action({
  args: {},
  handler: async (ctx): Promise<Array<{ leagueKey: string; name: string }>> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.yahoo.oauth.requireSignedInUserId,
      {},
    );
    return await withYahooToken(ctx, userId, async (accessToken) => {
      const json = await fetchYahooApi<unknown>(
        accessToken,
        "/users;use_login=1/games;game_keys=nfl/leagues",
      );
      const seen = new Map<string, { leagueKey: string; name: string }>();
      for (const node of findNodesByKey(json, "league")) {
        const fields = mergeYahooFields(node);
        if (typeof fields.league_key !== "string") continue;
        seen.set(fields.league_key, {
          leagueKey: fields.league_key,
          name: typeof fields.name === "string" ? fields.name : "Unknown league",
        });
      }
      return [...seen.values()];
    });
  },
});

export interface YahooTeamRow {
  teamKey: string;
  teamName: string;
  managerName: string;
  // Yahoo's team resource sets is_owned_by_current_login: 1 on whichever
  // team belongs to the signed-in account - unverified against a live
  // response (see YAHOO.md), used by previewYahooImport below to
  // auto-select "which team is me" the same way previewSleeperImport uses
  // the resolved Sleeper user_id.
  isCurrentUser: boolean;
}

// Shared by fetchYahooLeagueTeams (Season Settings' team-mapping step) and
// previewYahooImport below (creation-time import) - both need "every team
// in this league, with its manager name and whether it's the signed-in
// user's own team."
async function fetchYahooTeamsForLeague(
  accessToken: string,
  leagueKey: string,
): Promise<YahooTeamRow[]> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/league/${leagueKey}/teams`,
  );
  return findNodesByKey(json, "team")
    .map((node) => {
      const fields = mergeYahooFields(node);
      const managerFields = findNodesByKey(node, "manager").map((m) =>
        mergeYahooFields(m),
      );
      const managerName = managerFields[0]?.nickname;
      const isCurrentUser =
        fields.is_owned_by_current_login === 1 ||
        fields.is_owned_by_current_login === "1" ||
        fields.is_owned_by_current_login === true;
      return {
        teamKey: typeof fields.team_key === "string" ? fields.team_key : "",
        teamName: typeof fields.name === "string" ? fields.name : "Unknown team",
        managerName:
          typeof managerName === "string" ? managerName : "Unknown manager",
        isCurrentUser,
      };
    })
    .filter((team) => team.teamKey !== "");
}

export const fetchYahooLeagueTeams = action({
  args: { leagueKey: v.string() },
  handler: async (ctx, args): Promise<YahooTeamRow[]> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.yahoo.oauth.requireSignedInUserId,
      {},
    );
    return await withYahooToken(ctx, userId, (accessToken) =>
      fetchYahooTeamsForLeague(accessToken, args.leagueKey),
    );
  },
});

// Yahoo's own player ids share nothing with Sleeper's (the numbering
// convex/sleeper/client.ts's DEF_TEAM_FPIDS/player_id ids come from, which
// is what this app's fpid actually is) - there's no official crosswalk, so
// this resolves a Yahoo roster to fpids by matching full name + position
// against convex/schema.ts's players table. Inherently imperfect (name
// punctuation/suffix mismatches, genuine name collisions) - see YAHOO.md.
// Team defenses are skipped entirely rather than guessed at, since Yahoo
// names them by team ("49ers") while our DST rows are keyed by Sleeper's own
// synthetic ids - matching those reliably would need a second, separate
// team-name crosswalk this doesn't attempt.
function normalizeYahooPlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'-]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Shared match core for both resolveFpidsByName (live roster sync, only
// needs the resulting fpid set) and resolvePlayerKeysToFpids below (keeper-
// history import, which needs the fpid correlated back to a specific draft
// pick) - `index` lets each caller re-associate a match with whatever it
// sent in at that position, since unmatched/DEF entries are dropped rather
// than returned as null (a dense, positional array would force every caller
// to filter out placeholders anyway).
async function matchPlayersToFpids(
  ctx: QueryCtx,
  players: Array<{ name: string; position: string }>,
): Promise<Array<{ index: number; fpid: number }>> {
  const allPlayers: Doc<"players">[] = await ctx.db.query("players").collect();
  const byKey = new Map<string, number>();
  for (const player of allPlayers) {
    byKey.set(
      `${normalizeYahooPlayerName(player.name)}|${player.position}`,
      player.fpid,
    );
  }
  const matches: Array<{ index: number; fpid: number }> = [];
  players.forEach((player, index) => {
    if (player.position === "DEF" || player.position === "DST") return;
    const fpid = byKey.get(
      `${normalizeYahooPlayerName(player.name)}|${player.position}`,
    );
    if (fpid !== undefined) matches.push({ index, fpid });
  });
  return matches;
}

export const resolveFpidsByName = internalQuery({
  args: {
    players: v.array(v.object({ name: v.string(), position: v.string() })),
  },
  handler: async (ctx, args): Promise<number[]> => {
    const matches = await matchPlayersToFpids(ctx, args.players);
    return matches.map((m) => m.fpid);
  },
});

// Keeper-history counterpart to resolveFpidsByName - preserves which
// player_key each resolved fpid came from, so fetchPreviousYahooSeasonPreview
// below can re-attach a draft pick's price to the right fpid.
export const resolvePlayerKeysToFpids = internalQuery({
  args: {
    players: v.array(
      v.object({ playerKey: v.string(), name: v.string(), position: v.string() }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ playerKey: string; fpid: number }>> => {
    const matches = await matchPlayersToFpids(ctx, args.players);
    return matches.map((m) => ({
      playerKey: args.players[m.index]!.playerKey,
      fpid: m.fpid,
    }));
  },
});

function extractRosterPlayers(
  playerNodes: unknown[],
): Array<{ name: string; position: string }> {
  return playerNodes
    .map((node) => {
      const fields = mergeYahooFields(node);
      const nameField = fields.name as { full?: string } | undefined;
      const fullName = nameField?.full;
      const position = fields.display_position;
      if (typeof fullName !== "string" || typeof position !== "string") {
        return null;
      }
      return { name: fullName, position };
    })
    .filter((p): p is { name: string; position: string } => p !== null);
}

// Pulls every mapped team's current roster + FAAB spend from the linked
// Yahoo league (see schema.ts's seasons.yahooLeagueKey and
// seasonTeams.yahooTeamKey) and replaces rosterPlayers/faabSpent for each -
// same shape/purpose as convex/sleeper/league.ts's syncLeagueRoster, sharing
// its replaceRosterForTeam write path (convex/season/rosterPlayers.ts).
export const syncYahooLeagueRoster = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ syncedTeams: number }> => {
    const { season, league } = await ctx.runQuery(
      internal.season.rosterPlayers.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.yahooLeagueKey) {
      throw new Error("This league isn't linked to a Yahoo league yet.");
    }

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.draft.teams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );

    let syncedTeams = 0;
    await withYahooToken(ctx, league.ownerId, async (accessToken) => {
      for (const team of teams) {
        if (!team.yahooTeamKey) continue;

        const rosterJson = await fetchYahooApi<unknown>(
          accessToken,
          `/team/${team.yahooTeamKey}/roster`,
        );
        const rosterPlayers = extractRosterPlayers(
          findNodesByKey(rosterJson, "player"),
        );
        const fpids: number[] = await ctx.runQuery(
          internal.yahoo.league.resolveFpidsByName,
          { players: rosterPlayers },
        );

        // FAAB field name not confirmed live - see YAHOO.md. Best-effort:
        // a missing/unreachable field just leaves faabSpent at 0 rather
        // than failing the whole sync.
        let faabSpent = 0;
        try {
          const teamJson = await fetchYahooApi<unknown>(
            accessToken,
            `/team/${team.yahooTeamKey}`,
          );
          const teamNode = findNodesByKey(teamJson, "team")[0] ?? teamJson;
          const fields = mergeYahooFields(teamNode);
          const budgetUsed = fields.faab_balance ?? fields.waiver_budget_used;
          if (typeof budgetUsed === "string" || typeof budgetUsed === "number") {
            faabSpent = Number(budgetUsed) || 0;
          }
        } catch {
          // Leave faabSpent at 0.
        }

        // Standings fields (wins/losses/ties/pointsFor/pointsAgainst) aren't
        // fetched from Yahoo yet - infinileague's standings feature only
        // supports Sleeper-linked leagues today (see convex/sleeper/
        // league.ts's syncLeagueRoster for the real implementation). Zeroed
        // here rather than left unset so a Yahoo-linked season's standings
        // read as "no games yet" instead of undefined/missing.
        await ctx.runMutation(internal.season.rosterPlayers.replaceRosterForTeam, {
          seasonId: args.seasonId,
          teamId: team._id as Id<"seasonTeams">,
          fpids,
          faabSpent,
          wins: 0,
          losses: 0,
          ties: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        });
        syncedTeams += 1;
      }
    });

    return { syncedTeams };
  },
});

interface YahooLeagueSettingsSummary {
  name: string;
  season: string;
  teamCount: number;
  // Community-documented field marking a league renewed from a prior
  // season, format "{prior_game_id}_{prior_league_id}" (e.g. "423_9034") -
  // unverified against a live response, see YAHOO.md. Absent for a
  // brand-new (first-year) league.
  renew: string | undefined;
  // The full settings response, handed to mapYahooRosterPositions/
  // mapYahooScoringSettings, which each do their own deep search rather
  // than assume one exact nesting.
  raw: unknown;
}

async function fetchYahooLeagueSettings(
  accessToken: string,
  leagueKey: string,
): Promise<YahooLeagueSettingsSummary> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/league/${leagueKey}/settings`,
  );
  // Merge every node literally keyed "league" (not just the first) - Yahoo's
  // tree nests general league metadata (name/season/num_teams/renew) and the
  // settings sub-resource separately, and it's not confirmed which exact
  // depth each lands at. See YAHOO.md.
  const leagueFields = findNodesByKey(json, "league").reduce<
    Record<string, unknown>
  >((acc, node) => ({ ...acc, ...mergeYahooFields(node) }), {});
  return {
    name: typeof leagueFields.name === "string" ? leagueFields.name : "Unknown league",
    season:
      typeof leagueFields.season === "string"
        ? leagueFields.season
        : String(new Date().getFullYear()),
    teamCount: Number(leagueFields.num_teams) || 0,
    renew:
      typeof leagueFields.renew === "string" && leagueFields.renew
        ? leagueFields.renew
        : undefined,
    raw: json,
  };
}

function priorLeagueKeyFromRenew(renew: string): string | undefined {
  const match = /^(\d+)_(\d+)$/.exec(renew);
  if (!match) return undefined;
  return `${match[1]}.l.${match[2]}`;
}

interface YahooDraftPick {
  teamKey: string;
  playerKey: string;
  // Only present for auction drafts - absent (not zero) for a snake draft,
  // same "isAuction detected from whether any pick has a price" approach
  // convex/sleeper/league.ts's fetchPreviousSeasonPreview uses.
  cost: number | undefined;
}

// Sub-resource name ("draftresults", no underscore) is from general
// knowledge of the Yahoo Fantasy API, not a confirmed live response - see
// YAHOO.md.
async function fetchYahooDraftResults(
  accessToken: string,
  leagueKey: string,
): Promise<YahooDraftPick[]> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/league/${leagueKey}/draftresults`,
  );
  return findNodesByKey(json, "draft_result")
    .map((node) => mergeYahooFields(node))
    .map((fields) => ({
      teamKey: typeof fields.team_key === "string" ? fields.team_key : "",
      playerKey: typeof fields.player_key === "string" ? fields.player_key : "",
      cost:
        fields.cost !== undefined && fields.cost !== null
          ? Number(fields.cost)
          : undefined,
    }))
    .filter((pick) => pick.teamKey && pick.playerKey);
}

// Batched (Yahoo caps how many resources one request can return) player_key
// -> name/position lookup, needed because draftresults only gives ids, not
// names - draft picks are the one place this app needs player identity by
// key instead of by roster (see extractRosterPlayers above for the roster
// case, which gets names directly from the roster response).
async function fetchYahooPlayersByKeys(
  accessToken: string,
  playerKeys: string[],
): Promise<Map<string, { name: string; position: string }>> {
  const map = new Map<string, { name: string; position: string }>();
  const BATCH_SIZE = 25;
  for (let i = 0; i < playerKeys.length; i += BATCH_SIZE) {
    const batch = playerKeys.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    const json = await fetchYahooApi<unknown>(
      accessToken,
      `/players;player_keys=${batch.join(",")}`,
    );
    for (const node of findNodesByKey(json, "player")) {
      const fields = mergeYahooFields(node);
      const key = typeof fields.player_key === "string" ? fields.player_key : undefined;
      const nameField = fields.name as { full?: string } | undefined;
      const fullName = nameField?.full;
      const position = fields.display_position;
      if (key && typeof fullName === "string" && typeof position === "string") {
        map.set(key, { name: fullName, position });
      }
    }
  }
  return map;
}

export interface PreviousYahooSeasonTeamPreview {
  ownerId: string;
  teamName: string;
  players: Array<{ fpid: number; price: number | undefined }>;
}

export interface PreviousYahooSeasonPreview {
  season: string;
  isAuction: boolean;
  teams: PreviousYahooSeasonTeamPreview[];
}

// Best-effort, same degrade-gracefully contract as convex/sleeper/league.ts's
// fetchPreviousSeasonPreview: a missing `renew` field, an unreachable prior
// league, or any failure anywhere in this chain (settings/teams/draft
// results/player lookup) just means "no price data" for the import wizard,
// never a failed import.
async function fetchPreviousYahooSeasonPreview(
  ctx: ActionCtx,
  accessToken: string,
  renew: string | undefined,
): Promise<PreviousYahooSeasonPreview | undefined> {
  if (!renew) return undefined;
  const priorLeagueKey = priorLeagueKeyFromRenew(renew);
  if (!priorLeagueKey) return undefined;
  try {
    const [priorSettings, priorTeams, draftPicks] = await Promise.all([
      fetchYahooLeagueSettings(accessToken, priorLeagueKey),
      fetchYahooTeamsForLeague(accessToken, priorLeagueKey),
      fetchYahooDraftResults(accessToken, priorLeagueKey),
    ]);

    const isAuction = draftPicks.some((pick) => pick.cost !== undefined);
    const playerKeys = [...new Set(draftPicks.map((pick) => pick.playerKey))];
    const playersByKey = await fetchYahooPlayersByKeys(accessToken, playerKeys);

    const playerList = [...playersByKey.entries()].map(([playerKey, info]) => ({
      playerKey,
      ...info,
    }));
    const resolved: Array<{ playerKey: string; fpid: number }> = await ctx.runQuery(
      internal.yahoo.league.resolvePlayerKeysToFpids,
      { players: playerList },
    );
    const fpidByPlayerKey = new Map(resolved.map((r) => [r.playerKey, r.fpid]));

    const picksByTeam = new Map<string, YahooDraftPick[]>();
    for (const pick of draftPicks) {
      const list = picksByTeam.get(pick.teamKey) ?? [];
      list.push(pick);
      picksByTeam.set(pick.teamKey, list);
    }

    const teams: PreviousYahooSeasonTeamPreview[] = priorTeams.map((team) => ({
      ownerId: team.teamKey,
      teamName: team.teamName,
      players: (picksByTeam.get(team.teamKey) ?? [])
        .map((pick) => {
          const fpid = fpidByPlayerKey.get(pick.playerKey);
          if (fpid === undefined) return null;
          return { fpid, price: pick.cost };
        })
        .filter((p): p is { fpid: number; price: number | undefined } => p !== null),
    }));

    return { season: priorSettings.season, isAuction, teams };
  } catch {
    return undefined;
  }
}

export interface YahooImportPreview {
  name: string;
  season: string;
  teamCount: number;
  scoring: Scoring;
  rosterSlots: MappedRosterSlots["rosterSlots"];
  flexPositions: MappedRosterSlots["flexPositions"];
  superflexPositions: MappedRosterSlots["superflexPositions"];
  droppedSlots: string[];
  teams: YahooTeamRow[];
  previousSeason: PreviousYahooSeasonPreview | undefined;
}

// Powers the "Import from Yahoo" league-creation wizard: one round trip
// that returns everything needed to pre-fill SettingsForm, the team/self-
// mapping step, and (if this league renews from a prior season) enough
// data to seed keeper price history - mirrors convex/sleeper/league.ts's
// previewSleeperImport. Requires the caller to already have a connected
// Yahoo account (see convex/yahoo/oauth.ts) - the wizard checks
// getConnectionStatus and prompts to connect first if not.
export const previewYahooImport = action({
  args: { leagueKey: v.string() },
  handler: async (ctx, args): Promise<YahooImportPreview> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.yahoo.oauth.requireSignedInUserId,
      {},
    );
    return await withYahooToken(ctx, userId, async (accessToken) => {
      const settings = await fetchYahooLeagueSettings(accessToken, args.leagueKey);
      const mappedRoster = mapYahooRosterPositions(settings.raw);
      const scoring = mapYahooScoringSettings(settings.raw);
      const teams = await fetchYahooTeamsForLeague(accessToken, args.leagueKey);
      const previousSeason = await fetchPreviousYahooSeasonPreview(
        ctx,
        accessToken,
        settings.renew,
      );

      return {
        name: settings.name,
        season: settings.season,
        teamCount: settings.teamCount || teams.length,
        scoring,
        rosterSlots: mappedRoster.rosterSlots,
        flexPositions: mappedRoster.flexPositions,
        superflexPositions: mappedRoster.superflexPositions,
        droppedSlots: mappedRoster.droppedSlots,
        teams,
        previousSeason,
      };
    });
  },
});
