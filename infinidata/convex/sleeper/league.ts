import { v } from "convex/values";
import { action, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { DEF_TEAM_FPIDS, currentSeason } from "./client";
import { mapRosterPositions, mapScoringSettings } from "./leagueSettingsMapping";
import type { Scoring } from "../scoring";
import type { DraftType } from "../draftType";

// Sleeper's real, documented consumer API - same base fetchCurrentNflWeek
// uses (see ./state.ts), as opposed to the undocumented api.sleeper.com
// projections/stats endpoints in ./client.ts. No auth required.
const LEAGUE_API_BASE_URL = "https://api.sleeper.app/v1";

export interface SleeperRoster {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null;
  // Player ids on this roster's taxi squad (a subset of `players`, verified
  // live - not reflected in roster_positions/settings.rosterSlots at all,
  // that's governed separately by the league's own settings.taxi_slots).
  // Absent/null means the league doesn't use a taxi squad, or this roster
  // has none assigned yet.
  taxi?: string[] | null;
  // Player ids on injured reserve - same shape/verification as `taxi`
  // above, a subset of `players` that also isn't reflected in
  // roster_positions (governed by settings.reserve_slots instead). Needed
  // so an IR'd player isn't miscounted as an open bench slot.
  reserve?: string[] | null;
  // Player ids this roster has designated as keepers for the upcoming
  // draft - set by the commissioner/owner in Sleeper's own UI, independent
  // of whether that draft has actually run yet (unlike draftPicks.is_keeper
  // on the /draft/{id}/picks endpoint, which stays empty until the draft
  // itself executes - confirmed live against a real pre_draft-status
  // league). This is the only place Sleeper exposes pre-draft keeper
  // selections. Absent/null means the league doesn't use Sleeper's keeper
  // feature, or this owner hasn't picked any yet.
  keepers?: string[] | null;
  // Standings/waiver fields, verified live against a real league
  // (GET /league/{id}/rosters) - wins/losses/ties/waiver_position are
  // always present once a roster exists; fpts/fpts_decimal default to 0
  // pre-season but fpts_against/fpts_against_decimal are omitted entirely
  // (not just zero) until games have actually been played, hence optional.
  // fpts/fpts_against are split whole-number + hundredths pairs, not one
  // decimal field - see syncLeagueRoster's combination of the two.
  settings?: {
    waiver_budget_used?: number;
    wins?: number;
    losses?: number;
    ties?: number;
    fpts?: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_position?: number;
  };
}

export async function fetchSleeperJson<T>(path: string): Promise<T> {
  const response = await fetch(`${LEAGUE_API_BASE_URL}${path}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sleeper API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

async function fetchSleeperLeagueJson<T>(
  sleeperLeagueId: string,
  path: string,
): Promise<T> {
  return await fetchSleeperJson<T>(`/league/${sleeperLeagueId}${path}`);
}

// A Sleeper roster/draft-pick player id is either a numeric player_id (skill
// positions - same ids used everywhere else in this app as fpid) or a team
// abbreviation string for DST (Sleeper models defenses as players keyed by
// team, e.g. "SF") - translate those through the same synthetic ids
// DEF_TEAM_FPIDS uses for our own DST rows (see ./client.ts). Anything that's
// neither (a bye-week/practice-squad id we don't track) maps to null.
export function sleeperPlayerIdToFpid(playerId: string): number | null {
  if (DEF_TEAM_FPIDS[playerId] !== undefined) {
    return DEF_TEAM_FPIDS[playerId];
  }
  const numeric = Number(playerId);
  return Number.isFinite(numeric) ? numeric : null;
}

function toFpids(players: string[] | null): number[] {
  if (!players) return [];
  const fpids: number[] = [];
  for (const player of players) {
    const fpid = sleeperPlayerIdToFpid(player);
    if (fpid !== null) fpids.push(fpid);
  }
  return fpids;
}

// Pulls every mapped team's current roster + FAAB spend from the linked
// Sleeper league (see schema.ts's seasons.sleeperLeagueId and
// seasonTeams.sleeperRosterId) and replaces rosterPlayers/faabSpent for
// each. Manually triggered only (a "Sync Roster & FAAB" button) - unlike the
// daily projections cron, in-season rosters don't need to be fresh on a
// schedule, just fresh whenever the user is about to check bid suggestions.
// Sleeper's fpts/fpts_against are whole-number + hundredths pairs rather
// than one decimal field - combine once here instead of at every call site.
function combinePoints(whole: number | undefined, decimal: number | undefined): number {
  return (whole ?? 0) + (decimal ?? 0) / 100;
}

export const syncLeagueRoster = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<{ syncedTeams: number }> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.sleeperLeagueId) {
      throw new Error("This league isn't linked to a Sleeper league yet.");
    }

    const [rosters, leagueSettings] = await Promise.all([
      fetchSleeperLeagueJson<SleeperRoster[]>(season.sleeperLeagueId, "/rosters"),
      fetchSleeperLeagueSettings(season.sleeperLeagueId),
    ]);
    const rosterById = new Map(
      rosters.map((roster) => [String(roster.roster_id), roster]),
    );

    // Re-read every sync, not just at connect time - self-heals a season
    // connected before this field existed, and keeps up with a mid-season
    // commissioner change to waiver settings instead of going stale.
    await ctx.runMutation(internal.rosterSync.updateSeasonWaiverSettings, {
      seasonId: args.seasonId,
      waiverType: mapWaiverType(leagueSettings.settings?.waiver_type),
      ...(leagueSettings.settings?.waiver_budget !== undefined
        ? { faabBudget: leagueSettings.settings.waiver_budget }
        : {}),
    });

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );

    let syncedTeams = 0;
    for (const team of teams) {
      if (!team.sleeperRosterId) continue;
      const roster = rosterById.get(team.sleeperRosterId);
      if (!roster) continue;

      await ctx.runMutation(internal.rosterSync.replaceRosterForTeam, {
        seasonId: args.seasonId,
        teamId: team._id as Id<"seasonTeams">,
        fpids: toFpids(roster.players),
        faabSpent: roster.settings?.waiver_budget_used ?? 0,
        wins: roster.settings?.wins ?? 0,
        losses: roster.settings?.losses ?? 0,
        ties: roster.settings?.ties ?? 0,
        pointsFor: combinePoints(roster.settings?.fpts, roster.settings?.fpts_decimal),
        pointsAgainst: combinePoints(
          roster.settings?.fpts_against,
          roster.settings?.fpts_against_decimal,
        ),
        ...(roster.settings?.waiver_position !== undefined
          ? { waiverPosition: roster.settings.waiver_position }
          : {}),
      });
      syncedTeams += 1;
    }

    return { syncedTeams };
  },
});

export interface SleeperKeeperSuggestion {
  teamId: Id<"seasonTeams">;
  fpid: number;
}

// Reads which players each linked team has already marked as a keeper in
// Sleeper (roster.keepers - see SleeperRoster's comment above), for the
// "Import Keepers from Sleeper" panel on the Keepers tab. Deliberately
// doesn't write anything itself - Sleeper only tells us WHO was kept, not
// at what price, so this just hands the frontend a list of (team, fpid)
// candidates to confirm a cost for and add via the normal addKeeper
// mutation (convex/infinidraft/draft/picks.ts), same as any other keeper. Re-run on
// demand (not auto-synced) since keeper selections can keep changing right
// up to the commissioner's deadline.
export const listSleeperKeeperSuggestions = action({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx: ActionCtx,
    args,
  ): Promise<SleeperKeeperSuggestion[]> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.sleeperLeagueId) {
      throw new Error("This league isn't linked to a Sleeper league yet.");
    }

    const rosters = await fetchSleeperLeagueJson<SleeperRoster[]>(
      season.sleeperLeagueId,
      "/rosters",
    );
    const rosterById = new Map(
      rosters.map((roster) => [String(roster.roster_id), roster]),
    );

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );

    const suggestions: SleeperKeeperSuggestion[] = [];
    for (const team of teams) {
      if (!team.sleeperRosterId) continue;
      const roster = rosterById.get(team.sleeperRosterId);
      if (!roster) continue;
      for (const fpid of toFpids(roster.keepers ?? null)) {
        suggestions.push({ teamId: team._id as Id<"seasonTeams">, fpid });
      }
    }
    return suggestions;
  },
});

interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
}

interface LeagueTeamRow {
  rosterId: string;
  ownerId: string;
  teamName: string;
}

// Shared by fetchSleeperLeagueTeams (Part 3's team-mapping step) and
// previewSleeperImport below (creation-time import) - both need "every
// roster in this league, joined to its owner's display name," just at
// different points in the app's lifecycle.
async function fetchLeagueTeamRows(
  sleeperLeagueId: string,
): Promise<{ rows: LeagueTeamRow[]; rosters: SleeperRoster[] }> {
  const [rosters, users] = await Promise.all([
    fetchSleeperLeagueJson<SleeperRoster[]>(sleeperLeagueId, "/rosters"),
    fetchSleeperLeagueJson<SleeperLeagueUser[]>(sleeperLeagueId, "/users"),
  ]);
  const userById = new Map(users.map((user) => [user.user_id, user]));
  const rows = rosters
    .filter((roster) => roster.owner_id)
    .map((roster) => {
      const user = userById.get(roster.owner_id as string);
      return {
        rosterId: String(roster.roster_id),
        ownerId: roster.owner_id as string,
        teamName:
          user?.metadata?.team_name || user?.display_name || "Unknown team",
      };
    });
  return { rows, rosters };
}

// Used by the team-mapping step in Settings (link each app draftTeams row to
// a real Sleeper roster/owner) - separate from syncLeagueRoster's rosters
// call since this needs owner display names, which /rosters doesn't include.
export const fetchSleeperLeagueTeams = action({
  args: { sleeperLeagueId: v.string() },
  handler: async (_ctx, args): Promise<LeagueTeamRow[]> => {
    const { rows } = await fetchLeagueTeamRows(args.sleeperLeagueId);
    return rows;
  },
});

interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
}

async function fetchSleeperUserByUsername(
  username: string,
): Promise<SleeperUser | null> {
  return await fetchSleeperJson<SleeperUser | null>(
    `/user/${encodeURIComponent(username)}`,
  );
}

interface SleeperLeagueSummary {
  league_id: string;
  name: string;
  season: string;
}

// Resolves a Sleeper username to that account's user_id, then lists their
// leagues for the current NFL season - lets the linking/import UI offer a
// league picker (like the Yahoo flow's listMyYahooLeagues) instead of
// requiring the user to dig a numeric league id out of Sleeper's URL. Both
// endpoints are public/unauthenticated, same as everything else in this
// file - Sleeper has no login concept for this app to hook into, a username
// is just a public lookup key.
export const listSleeperLeaguesForUsername = action({
  args: { username: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{
    sleeperUserId: string;
    leagues: Array<{ leagueId: string; name: string; season: string }>;
  }> => {
    const username = args.username.trim();
    if (!username) {
      throw new Error("Enter a Sleeper username.");
    }
    const user = await fetchSleeperUserByUsername(username);
    if (!user) {
      throw new Error(`No Sleeper user found for username "${username}".`);
    }
    const leagues = await fetchSleeperJson<SleeperLeagueSummary[]>(
      `/user/${user.user_id}/leagues/nfl/${currentSeason()}`,
    );
    return {
      sleeperUserId: user.user_id,
      leagues: leagues.map((league) => ({
        leagueId: league.league_id,
        name: league.name,
        season: league.season,
      })),
    };
  },
});

interface SleeperLeagueSettings {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings?: { rec?: number };
  previous_league_id?: string | null;
  draft_id?: string | null;
  // waiver_budget is present (defaulted to 100) even for a league that
  // doesn't use FAAB at all - verified live - so it's only meaningful
  // alongside waiver_type actually being FAAB (see mapWaiverType below).
  // waiver_type's 0/1/2 meaning isn't documented by Sleeper's own docs.
  // An initial pass here trusted a third-party adapter (mistakia/league's
  // sleeper.mjs) claiming 1 = FAAB, 0/2 = priority - that was wrong, caught
  // when a real connected league (Sleeper waiver_type 2) that's actually
  // FAAB showed up as waiver-priority in the app. Corrected against a
  // second, more precise third-party reference (paul-macfarlane/sleepy's
  // references/sleeper-api.md: "waiver_type: 0=none/rolling, 1=reversed
  // record, 2=FAAB") AND empirically confirmed across 5 real leagues (one
  // user-verified as FAAB, matching its waiver_type=2; the other four's
  // values were internally consistent with this same rule). 0 and 1 are
  // both priority-based (rolling vs. reverse-standings - both use
  // roster.settings.waiver_position), only 2 is FAAB.
  settings?: {
    waiver_type?: number;
    waiver_budget?: number;
    // Configured taxi squad size - verified live (Shadynasty's: 2) -
    // independent of roster_positions, which never lists "TAXI" itself.
    // Absent means the league doesn't use a taxi squad at all.
    taxi_slots?: number;
  };
}

export function mapWaiverType(
  sleeperWaiverType: number | undefined,
): "faab" | "priority" {
  return sleeperWaiverType === 2 ? "faab" : "priority";
}

export async function fetchSleeperLeagueSettings(
  sleeperLeagueId: string,
): Promise<SleeperLeagueSettings> {
  return await fetchSleeperLeagueJson<SleeperLeagueSettings>(
    sleeperLeagueId,
    "",
  );
}

// Extended (status/start_time) for convex/sleeper/draftSync.ts's live
// poller - fetchPreviousSeasonPreview below only ever needed draft_id/type,
// but the live poller needs status ("pre_draft"/"drafting"/"paused"/
// "complete", per Sleeper's docs - kept as a plain string here rather than a
// literal union since Sleeper doesn't formally enumerate every value) to
// know when to stop, and start_time (unix ms) to auto-start the in-app
// draft ~10 minutes ahead of the real thing.
export interface SleeperDraft {
  draft_id: string;
  type: "snake" | "auction" | "linear";
  status: string;
  start_time?: number;
}

// Extended (pick_no/roster_id/picked_by) for the live poller -
// fetchPreviousSeasonPreview below only ever needed player_id/metadata.
// amount/round for a completed draft's keeper-price/keeper-round seeding,
// but live sync needs pick order and which roster/owner made the pick to
// map it to a seasonTeams row.
export interface SleeperDraftPick {
  player_id: string;
  // Only meaningful for an auction draft.
  metadata?: { amount?: string };
  // Only meaningful for a snake/linear draft (SNAKE_DRAFT.md §6/§8) - a
  // top-level field on every pick regardless of format, just unused by
  // Sleeper's own UI for an auction draft.
  round?: number;
  pick_no: number;
  roster_id: number | null;
  picked_by: string | null;
}

// Best-effort: the current league's own draft type (SNAKE_DRAFT.md §6) -
// Sleeper's three draft.type values already match our DraftType union
// exactly, so no remapping is needed once fetched. Returns undefined for a
// league with no draft set up yet, or any fetch hiccup - the import wizard
// falls back to "auction" in that case, same as before this existed.
async function fetchSleeperDraftType(
  draftId: string,
): Promise<DraftType | undefined> {
  try {
    const draft = await fetchSleeperJson<SleeperDraft>(`/draft/${draftId}`);
    return draft.type;
  } catch {
    return undefined;
  }
}

export interface PreviousSeasonTeamPreview {
  rosterId: string;
  ownerId: string;
  teamName: string;
  players: Array<{
    fpid: number;
    price: number | undefined;
    // Round counterpart to price above (SNAKE_DRAFT.md §6/§8) - only ever
    // set when draftType (below) was "snake"/"linear"; price is only ever
    // set when it was "auction". Never both.
    round: number | undefined;
  }>;
}

export interface PreviousSeasonPreview {
  season: string;
  // Undefined when the previous league had no draft on Sleeper, or the
  // lookup failed - the wizard falls back to "eligibility only" (no
  // price/round on any player) in that case, same as before draftType was
  // detected at all.
  draftType: DraftType | undefined;
  teams: PreviousSeasonTeamPreview[];
}

// Best-effort: a missing/unreachable previous league, or any other hiccup,
// just means "no price/round data" rather than failing the whole import -
// see Part 4's plan doc on why keeper-history seeding degrades gracefully
// instead of requiring exact prior-draft history.
async function fetchPreviousSeasonPreview(
  previousLeagueId: string,
): Promise<PreviousSeasonPreview | undefined> {
  try {
    const [prevSettings, { rows, rosters }] = await Promise.all([
      fetchSleeperLeagueSettings(previousLeagueId),
      fetchLeagueTeamRows(previousLeagueId),
    ]);

    let priceByPlayerId = new Map<string, number>();
    let roundByPlayerId = new Map<string, number>();
    let draftType: DraftType | undefined;
    if (prevSettings.draft_id) {
      try {
        const draft = await fetchSleeperJson<SleeperDraft>(
          `/draft/${prevSettings.draft_id}`,
        );
        draftType = draft.type;
        const picks = await fetchSleeperJson<SleeperDraftPick[]>(
          `/draft/${prevSettings.draft_id}/picks`,
        );
        if (draftType === "auction") {
          priceByPlayerId = new Map(
            picks
              .map((pick): [string, number] => [
                pick.player_id,
                Number(pick.metadata?.amount),
              ])
              .filter(([, amount]) => Number.isFinite(amount)),
          );
        } else {
          roundByPlayerId = new Map(
            picks
              .map((pick): [string, number] => [
                pick.player_id,
                Number(pick.round),
              ])
              .filter(([, round]) => Number.isFinite(round)),
          );
        }
      } catch {
        // No draft history available - proceed with rosters only, no
        // prices/rounds.
      }
    }

    const rosterByOwnerId = new Map(rosters.map((r) => [r.owner_id, r]));
    const teams: PreviousSeasonTeamPreview[] = rows.map((row) => {
      const roster = rosterByOwnerId.get(row.ownerId);
      const players = (roster?.players ?? [])
        .map((playerId) => {
          const fpid = sleeperPlayerIdToFpid(playerId);
          if (fpid === null) return null;
          return {
            fpid,
            price: priceByPlayerId.get(playerId),
            round: roundByPlayerId.get(playerId),
          };
        })
        .filter(
          (
            p,
          ): p is {
            fpid: number;
            price: number | undefined;
            round: number | undefined;
          } => p !== null,
        );
      return { ...row, players };
    });

    return { season: prevSettings.season, draftType, teams };
  } catch {
    return undefined;
  }
}

export interface SleeperImportPreview {
  name: string;
  season: string;
  teamCount: number;
  // Undefined when this league has no draft set up on Sleeper yet, or the
  // lookup otherwise failed (see fetchSleeperDraftType) - the wizard falls
  // back to "auction" in that case, same as before this was detected at all.
  draftType: DraftType | undefined;
  scoring: Scoring;
  rosterSlots: ReturnType<typeof mapRosterPositions>["rosterSlots"];
  flexPositions: ReturnType<typeof mapRosterPositions>["flexPositions"];
  superflexPositions: ReturnType<typeof mapRosterPositions>["superflexPositions"];
  droppedSlots: string[];
  teams: LeagueTeamRow[];
  previousSeason: PreviousSeasonPreview | undefined;
}

// Powers the "Import from Sleeper" league-creation wizard (see Part 4 of the
// plan doc): one round trip that returns everything needed to pre-fill
// SettingsForm, the team/self-mapping step, and (if a prior season with an
// auction draft is found) enough data to seed keeper price history. No auth
// check, same as fetchSleeperLeagueTeams above - this only ever reads
// Sleeper's own public data, nothing in our DB.
export const previewSleeperImport = action({
  args: { sleeperLeagueId: v.string() },
  handler: async (_ctx, args): Promise<SleeperImportPreview> => {
    const settings = await fetchSleeperLeagueSettings(args.sleeperLeagueId);
    const mapped = mapRosterPositions(settings.roster_positions ?? []);
    const scoring = mapScoringSettings(settings.scoring_settings);
    const { rows: teams } = await fetchLeagueTeamRows(args.sleeperLeagueId);

    const draftType = settings.draft_id
      ? await fetchSleeperDraftType(settings.draft_id)
      : undefined;

    const previousSeason = settings.previous_league_id
      ? await fetchPreviousSeasonPreview(settings.previous_league_id)
      : undefined;

    return {
      name: settings.name,
      season: settings.season,
      teamCount: settings.total_rosters,
      draftType,
      scoring,
      rosterSlots: mapped.rosterSlots,
      flexPositions: mapped.flexPositions,
      superflexPositions: mapped.superflexPositions,
      droppedSlots: mapped.droppedSlots,
      teams,
      previousSeason,
    };
  },
});
