import { v } from "convex/values";
import { action, internalQuery, type ActionCtx, type QueryCtx } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Doc, Id } from "../../_generated/dataModel";
import { fetchYahooApi, mergeYahooFields, findNodesByKey } from "./client";
import { withYahooToken } from "./oauth";
import { DEF_TEAM_FPIDS } from "../../sleeper/client";
import {
  mapYahooRosterPositions,
  mapYahooScoringSettings,
  mapYahooWaiverType,
  type MappedRosterSlots,
} from "./leagueSettingsMapping";
import type { Scoring } from "../../scoring";

export const listMyYahooLeagues = action({
  args: {},
  handler: async (ctx): Promise<Array<{ leagueKey: string; name: string }>> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.infinidraft.yahoo.oauth.requireSignedInUserId,
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
  const teamNodes = findNodesByKey(json, "team");
  if (teamNodes.length === 0) {
    // Diagnostic for the "opponent names required (got 0)" failure mode -
    // remove once the team-parsing shape in mergeYahooFields/findNodesByKey
    // is confirmed against a real response and this stops happening.
    console.error("fetchYahooTeamsForLeague: no team nodes found, raw response:", JSON.stringify(json));
  }
  return teamNodes
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

export interface YahooTeamStandings {
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
}

// One request covers every team in the league (unlike the per-team FAAB
// balance lookup in syncYahooLeagueRoster below, which has no known
// collection-level equivalent) - endpoint `/league/{leagueKey}/standings`,
// each team node's `team_standings.outcome_totals.wins/losses/ties` and
// `team_standings.points_for/points_against` fields, from general knowledge
// of Yahoo's Fantasy API and NOT confirmed against a live response (see
// YAHOO.md). Best-effort per team: one missing/unreachable team_standings
// subtree just leaves that team out of the returned map rather than failing
// the whole sync - syncYahooLeagueRoster falls back to zeroed standings for
// any team not found here.
async function fetchYahooStandingsForLeague(
  accessToken: string,
  leagueKey: string,
): Promise<Map<string, YahooTeamStandings>> {
  const json = await fetchYahooApi<unknown>(
    accessToken,
    `/league/${leagueKey}/standings`,
  );
  const standingsByTeamKey = new Map<string, YahooTeamStandings>();
  for (const node of findNodesByKey(json, "team")) {
    const fields = mergeYahooFields(node);
    const teamKey = typeof fields.team_key === "string" ? fields.team_key : undefined;
    if (!teamKey) continue;
    const standingsFields = mergeYahooFields(fields.team_standings);
    const outcomeTotals = mergeYahooFields(standingsFields.outcome_totals);
    standingsByTeamKey.set(teamKey, {
      wins: Number(outcomeTotals.wins) || 0,
      losses: Number(outcomeTotals.losses) || 0,
      ties: Number(outcomeTotals.ties) || 0,
      pointsFor: Number(standingsFields.points_for) || 0,
      pointsAgainst: Number(standingsFields.points_against) || 0,
    });
  }
  if (standingsByTeamKey.size === 0) {
    // Diagnostic for a still-unconfirmed shape - remove once checked
    // against a real response and this stops happening.
    console.error(
      "fetchYahooStandingsForLeague: no team standings found, raw response:",
      JSON.stringify(json),
    );
  }
  return standingsByTeamKey;
}

export const fetchYahooLeagueTeams = action({
  args: { leagueKey: v.string() },
  handler: async (ctx, args): Promise<YahooTeamRow[]> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.infinidraft.yahoo.oauth.requireSignedInUserId,
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
// Team defenses are matched separately (see normalizeYahooTeamAbbr below),
// since Yahoo names them by city/mascot ("49ers") rather than a name that'd
// ever match our DST rows, which are keyed by Sleeper's own synthetic ids.
function normalizeYahooPlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'-]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Yahoo's `editorial_team_abbr` field (present on every player, including
// DEF/DST entries - it's just "which NFL team is this") doesn't always
// match Sleeper's DEF_TEAM_FPIDS keys byte-for-byte. These two are the
// mismatches commonly documented between Yahoo's and other providers' team
// abbreviation conventions - not confirmed against a live Yahoo response
// (see YAHOO.md). Anything else is assumed to already match after
// uppercasing; an abbreviation that still doesn't resolve just drops that
// team's DST from the roster (see matchPlayersToFpids below) rather than
// guessing further.
const YAHOO_TEAM_ABBR_ALIASES: Record<string, string> = {
  JAC: "JAX",
  WSH: "WAS",
};

function normalizeYahooTeamAbbr(abbr: string): string {
  const upper = abbr.toUpperCase();
  return YAHOO_TEAM_ABBR_ALIASES[upper] ?? upper;
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
  players: Array<{ name: string; position: string; teamAbbr?: string }>,
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
    if (player.position === "DEF" || player.position === "DST") {
      if (!player.teamAbbr) return;
      const fpid = DEF_TEAM_FPIDS[normalizeYahooTeamAbbr(player.teamAbbr)];
      if (fpid !== undefined) matches.push({ index, fpid });
      return;
    }
    const fpid = byKey.get(
      `${normalizeYahooPlayerName(player.name)}|${player.position}`,
    );
    if (fpid !== undefined) matches.push({ index, fpid });
  });
  return matches;
}

export const resolveFpidsByName = internalQuery({
  args: {
    players: v.array(
      v.object({
        name: v.string(),
        position: v.string(),
        teamAbbr: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<number[]> => {
    const matches = await matchPlayersToFpids(ctx, args.players);
    return matches.map((m) => m.fpid);
  },
});

// Keeper-history counterpart to resolveFpidsByName - preserves which
// player_key each resolved fpid came from, so fetchPreviousYahooSeasonPreview
// below can re-attach a draft pick's price to the right fpid, and
// convex/infinileague/season/teamRoster.ts's per-week Yahoo lineup /
// convex/infinidraft/yahoo/draftSync.ts's live poller can re-attach a
// slot/pick. teamAbbr is optional since not every caller's source data
// carries it, but fetchYahooPlayersByKeys below does fetch it now, so DST
// resolves here too, not just via the roster-sync/live-poller paths.
export const resolvePlayerKeysToFpids = internalQuery({
  args: {
    players: v.array(
      v.object({
        playerKey: v.string(),
        name: v.string(),
        position: v.string(),
        teamAbbr: v.optional(v.string()),
      }),
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

// Primary player-resolution path for convex/infinidraft/yahoo/draftSync.ts's
// live poller - a direct point lookup via schema.ts's players.by_yahoo_id
// index (populated from Sleeper's own player directory, see that field's
// schema comment) instead of the lossier name-match matchPlayersToFpids
// above uses. NOT confirmed live that Sleeper's yahoo_id numbering actually
// matches the numeric id Yahoo's own player_key encodes (see YAHOO.md) -
// callers should fall back to resolvePlayerKeysToFpids (name-match) for any
// playerId this misses, same as it already must for DST (no yahooId at
// all).
export const resolveFpidsByYahooId = internalQuery({
  args: { playerIds: v.array(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ playerId: number; fpid: number }>> => {
    const matches: Array<{ playerId: number; fpid: number }> = [];
    for (const playerId of args.playerIds) {
      const player = await ctx.db
        .query("players")
        .withIndex("by_yahoo_id", (q) => q.eq("yahooId", playerId))
        .unique();
      if (player) matches.push({ playerId, fpid: player.fpid });
    }
    return matches;
  },
});

// Exported for convex/infinidraft/yahoo/waivers.ts's reuse - same
// name+position(+team, for DEF/DST) extraction from a Yahoo player node,
// needed by anything that has to resolve a Yahoo player list to our own
// fpids (see resolveFpidsByName below). teamAbbr comes from
// editorial_team_abbr, present on every player node (not just DEF/DST) -
// field name from general knowledge of Yahoo's Fantasy API, not confirmed
// against a live response (see YAHOO.md).
export function extractRosterPlayers(
  playerNodes: unknown[],
): Array<{ name: string; position: string; teamAbbr?: string }> {
  return playerNodes
    .map((node) => {
      const fields = mergeYahooFields(node);
      const nameField = fields.name as { full?: string } | undefined;
      const fullName = nameField?.full;
      const position = fields.display_position;
      if (typeof fullName !== "string" || typeof position !== "string") {
        return null;
      }
      const teamAbbr =
        typeof fields.editorial_team_abbr === "string"
          ? fields.editorial_team_abbr
          : undefined;
      return { name: fullName, position, ...(teamAbbr ? { teamAbbr } : {}) };
    })
    .filter(
      (p): p is { name: string; position: string; teamAbbr?: string } => p !== null,
    );
}

// Pulls every mapped team's current roster + FAAB spend from the linked
// Yahoo league (see schema.ts's seasons.yahooLeagueKey and
// seasonTeams.yahooTeamKey) and replaces rosterPlayers/faabSpent for each -
// same shape/purpose as convex/sleeper/league.ts's syncLeagueRoster, sharing
// its replaceRosterForTeam write path (convex/rosterSync.ts).
export const syncYahooLeagueRoster = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ syncedTeams: number }> => {
    const { season, league } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.yahooLeagueKey) {
      throw new Error("This league isn't linked to a Yahoo league yet.");
    }
    const yahooLeagueKey = season.yahooLeagueKey;

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );

    let syncedTeams = 0;
    await withYahooToken(ctx, league.ownerId, async (accessToken) => {
      const [standingsByTeamKey, settings] = await Promise.all([
        fetchYahooStandingsForLeague(accessToken, yahooLeagueKey),
        fetchYahooLeagueSettings(accessToken, yahooLeagueKey),
      ]);

      // Re-read every sync, not just at connect time - same self-healing
      // rationale as convex/sleeper/league.ts's syncLeagueRoster. Doesn't
      // pass faabBudget (see mapYahooWaiverType's comment) - leaves
      // whatever the commissioner has set in Season Settings untouched.
      await ctx.runMutation(internal.rosterSync.updateSeasonWaiverSettings, {
        seasonId: args.seasonId,
        waiverType: mapYahooWaiverType(settings.raw),
      });

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
          internal.infinidraft.yahoo.league.resolveFpidsByName,
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
          const remainingBalance = fields.faab_balance ?? fields.waiver_budget_used;
          if (typeof remainingBalance === "string" || typeof remainingBalance === "number") {
            // faab_balance is the team's current REMAINING FAAB dollars,
            // not amount spent (confirmed live: every team read "-100 FAAB
            // left" when this stored the raw balance straight into
            // faabSpent). Converting remaining -> spent against whatever
            // budget baseline getStandings/bids.ts will later subtract it
            // back out of (faabBudgetOverride ?? season.faabBudget ?? 0)
            // makes the two operations exact inverses regardless of that
            // budget's actual value - this doesn't need Yahoo's real
            // configured budget at all, just internal consistency with the
            // read side. See YAHOO.md.
            const effectiveBudget = team.faabBudgetOverride ?? season.faabBudget ?? 0;
            faabSpent = effectiveBudget - Number(remainingBalance);
          }
        } catch {
          // Leave faabSpent at 0.
        }

        // Falls back to zeroed standings (rather than leaving them unset)
        // for any team fetchYahooStandingsForLeague didn't find a match
        // for, so a Yahoo-linked season's standings read as "no games yet"
        // instead of undefined/missing.
        const standings = standingsByTeamKey.get(team.yahooTeamKey);
        await ctx.runMutation(internal.rosterSync.replaceRosterForTeam, {
          seasonId: args.seasonId,
          teamId: team._id as Id<"seasonTeams">,
          fpids,
          faabSpent,
          wins: standings?.wins ?? 0,
          losses: standings?.losses ?? 0,
          ties: standings?.ties ?? 0,
          pointsFor: standings?.pointsFor ?? 0,
          pointsAgainst: standings?.pointsAgainst ?? 0,
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

// Bare `/league/{leagueKey}` (not `/settings`) so convex/infinidraft/yahoo/
// draftSync.ts's live poller can check this every tick without pulling the
// much larger settings/roster_positions/stat_categories payload each time.
// Confirmed (public Yahoo docs) values: "predraft", "postdraft" - the
// in-progress value's exact string is NOT confirmed; callers should treat
// anything other than "predraft" as "drafting has started" rather than
// check for a specific in-progress string, and only treat "postdraft" as
// complete (never inferred from absence of "predraft") - see YAHOO.md.
export async function fetchYahooDraftStatus(
  accessToken: string,
  leagueKey: string,
): Promise<string | undefined> {
  const json = await fetchYahooApi<unknown>(accessToken, `/league/${leagueKey}`);
  const leagueFields = findNodesByKey(json, "league").reduce<
    Record<string, unknown>
  >((acc, node) => ({ ...acc, ...mergeYahooFields(node) }), {});
  const draftStatus =
    typeof leagueFields.draft_status === "string" ? leagueFields.draft_status : undefined;
  if (draftStatus === undefined) {
    // Diagnostic for an unconfirmed shape - remove once checked against a
    // real response and this stops happening.
    console.error(
      "fetchYahooDraftStatus: draft_status not found, raw response:",
      JSON.stringify(json),
    );
  }
  return draftStatus;
}

function priorLeagueKeyFromRenew(renew: string): string | undefined {
  const match = /^(\d+)_(\d+)$/.exec(renew);
  if (!match) return undefined;
  return `${match[1]}.l.${match[2]}`;
}

export interface YahooDraftPick {
  teamKey: string;
  playerKey: string;
  // Only present for auction drafts - absent (not zero) for a snake draft,
  // same "isAuction detected from whether any pick has a price" approach
  // convex/sleeper/league.ts's fetchPreviousSeasonPreview uses.
  cost: number | undefined;
  // pick/round: confirmed present on draft_result entries per Yahoo's
  // public API docs (not this app's own live testing yet - see YAHOO.md).
  // Unused by the historical/keeper-price importer below (which only needs
  // teamKey/playerKey/cost), added for convex/infinidraft/yahoo/draftSync.ts's
  // live poller, which needs pick for insertion ordering (same role
  // Sleeper's pick_no plays in applySleeperSyncTick) and round for
  // resolveTeamPositionInRound in snake/linear leagues. Whether round is
  // present/meaningful for auction-type leagues is unconfirmed - the live
  // poller must tolerate its absence there.
  pick: number | undefined;
  round: number | undefined;
}

// Sub-resource name ("draftresults", no underscore) is from general
// knowledge of the Yahoo Fantasy API, not a confirmed live response - see
// YAHOO.md. Exported for convex/infinidraft/yahoo/draftSync.ts's reuse -
// same endpoint, live poller just needs pick/round too (see YahooDraftPick).
// Whether this endpoint returns anything before a draft is fully complete
// (as opposed to only once "postdraft") is the single biggest unconfirmed
// assumption behind the whole live-sync feature - see YAHOO.md.
export async function fetchYahooDraftResults(
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
      pick:
        fields.pick !== undefined && fields.pick !== null
          ? Number(fields.pick)
          : undefined,
      round:
        fields.round !== undefined && fields.round !== null
          ? Number(fields.round)
          : undefined,
    }))
    .filter((pick) => pick.teamKey && pick.playerKey);
}

// Batched (Yahoo caps how many resources one request can return) player_key
// -> name/position/team lookup, needed because draftresults only gives ids,
// not names - draft picks are the one place this app needs player identity
// by key instead of by roster (see extractRosterPlayers above for the
// roster case, which gets names directly from the roster response).
// Exported for convex/infinidraft/yahoo/draftSync.ts's reuse as the live
// poller's DST fallback path (see resolvePlayerKeysToFpids's teamAbbr arg,
// added for exactly this - editorial_team_abbr is what lets a DEF/DST pick
// resolve via the team-abbreviation crosswalk instead of being dropped, the
// same fix already applied to the roster-sync path in extractRosterPlayers).
export async function fetchYahooPlayersByKeys(
  accessToken: string,
  playerKeys: string[],
): Promise<Map<string, { name: string; position: string; teamAbbr?: string }>> {
  const map = new Map<string, { name: string; position: string; teamAbbr?: string }>();
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
      const teamAbbr =
        typeof fields.editorial_team_abbr === "string"
          ? fields.editorial_team_abbr
          : undefined;
      if (key && typeof fullName === "string" && typeof position === "string") {
        map.set(key, { name: fullName, position, ...(teamAbbr ? { teamAbbr } : {}) });
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
      internal.infinidraft.yahoo.league.resolvePlayerKeysToFpids,
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
// Yahoo account (see convex/infinidraft/yahoo/oauth.ts) - the wizard checks
// getConnectionStatus and prompts to connect first if not.
export const previewYahooImport = action({
  args: { leagueKey: v.string() },
  handler: async (ctx, args): Promise<YahooImportPreview> => {
    const userId: Id<"users"> = await ctx.runQuery(
      internal.infinidraft.yahoo.oauth.requireSignedInUserId,
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
