import { v } from "convex/values";
import { action, internalQuery, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import { currentSeason } from "../lib/dataFetch";
import { DEF_TEAM_FPIDS } from "../sleeper/client";
import { normalizePlayerName } from "../playerNameMatch";
import {
  mapEspnDraftType,
  mapEspnRosterSlots,
  mapEspnScoring,
  mapEspnSixPointPassTds,
  mapEspnTeScoring,
  mapEspnWaiverType,
  type EspnLeagueSettings,
} from "./leagueSettingsMapping";
import type { MappedRosterSlots } from "../sleeper/leagueSettingsMapping";
import type { Scoring, TeScoring } from "../scoring";
import type { DraftType } from "../draftType";

// ESPN's fantasy league API - same undocumented lm-api-reads host
// convex/espn/client.ts reads player rankings from. No auth: this only
// works for leagues the league manager has made public ("Make League
// Viewable to Public" in ESPN's Basic Settings). A private league needs the
// member's espn_s2/SWID cookies, which this app deliberately doesn't
// collect yet - ESPN answers 401 for those, surfaced as a plain-language
// error below. Every response shape here was confirmed live 2026-10-10
// against a real public league (164483).
const LEAGUE_API_BASE_URL =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";

interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: {
    player?: {
      id: number;
      fullName?: string;
      defaultPositionId?: number;
      proTeamId?: number;
      // statSourceId 0 = actual, 1 = projected; appliedTotal is already in
      // this league's own scoring. One block per (season, period) - see
      // fetchEspnTeamWeekEntries.
      stats?: Array<{
        seasonId: number;
        scoringPeriodId: number;
        statSourceId: number;
        appliedTotal?: number;
      }>;
    };
  };
}

interface EspnTeam {
  id: number;
  // Newer leagues carry one `name`; older ones split it into location +
  // nickname (both null on the confirmed-live league) - see espnTeamName.
  name?: string | null;
  location?: string | null;
  nickname?: string | null;
  abbrev?: string;
  primaryOwner?: string;
  waiverRank?: number;
  record?: {
    overall?: {
      wins?: number;
      losses?: number;
      ties?: number;
      pointsFor?: number;
      pointsAgainst?: number;
    };
  };
  // FAAB dollars spent so far this season (not remaining).
  transactionCounter?: { acquisitionBudgetSpent?: number };
  roster?: { entries?: EspnRosterEntry[] };
}

interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

interface EspnScheduleEntry {
  matchupPeriodId: number;
  home?: { teamId: number };
  away?: { teamId: number };
}

interface EspnLeague {
  id: number;
  seasonId: number;
  settings?: EspnLeagueSettings;
  teams?: EspnTeam[];
  members?: EspnMember[];
  schedule?: EspnScheduleEntry[];
}

async function fetchEspnLeague(
  espnLeagueId: string,
  season: string,
  views: string[],
  // e.g. scoringPeriodId - scopes mRoster to that week's lineup.
  extraParams: Record<string, string> = {},
): Promise<EspnLeague> {
  const query = [
    ...views.map((view) => `view=${view}`),
    ...Object.entries(extraParams).map(
      ([key, value]) => `${key}=${encodeURIComponent(value)}`,
    ),
  ].join("&");
  const response = await fetch(
    `${LEAGUE_API_BASE_URL}/seasons/${season}/segments/0/leagues/${encodeURIComponent(espnLeagueId)}?${query}`,
  );
  if (response.status === 401) {
    throw new Error(
      "This ESPN league is private. Only public ESPN leagues can be added " +
        "right now - your league manager can turn on \"Make League Viewable " +
        "to Public\" in ESPN's League Settings > Basic Settings.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      `No ESPN league found with id ${espnLeagueId} for the ${season} season.`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ESPN league request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

// Accepts either a bare league id or anything pasted from the browser's
// address bar on an ESPN league page (every ESPN fantasy URL for a league
// carries ?leagueId=...), since ESPN shows the id nowhere else.
export function parseEspnLeagueId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /[?&]leagueId=(\d+)/i.exec(trimmed);
  if (fromUrl?.[1]) return fromUrl[1];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new Error("Enter an ESPN league ID, or paste your league's ESPN URL.");
}

function espnTeamName(team: EspnTeam): string {
  if (team.name?.trim()) return team.name.trim();
  const joined = [team.location, team.nickname].filter(Boolean).join(" ").trim();
  return joined || team.abbrev || `Team ${team.id}`;
}

function espnMemberName(member: EspnMember | undefined): string | undefined {
  if (!member) return undefined;
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return member.displayName || fullName || undefined;
}

// ESPN's proTeamId -> this app's (Sleeper's) team abbreviation, for D/ST
// entries (ESPN's D/ST player id is -16000 - proTeamId; our DST fpids are
// synthetic and never carry an espnId - see DEF_TEAM_FPIDS). Spot-checked
// live against a real roster's players' proTeamIds.
const ESPN_PRO_TEAM_ABBR: Record<number, string> = {
  1: "ATL", 2: "BUF", 3: "CHI", 4: "CIN", 5: "CLE", 6: "DAL", 7: "DEN",
  8: "DET", 9: "GB", 10: "TEN", 11: "IND", 12: "KC", 13: "LV", 14: "LAR",
  15: "MIA", 16: "MIN", 17: "NE", 18: "NO", 19: "NYG", 20: "NYJ", 21: "PHI",
  22: "ARI", 23: "PIT", 24: "LAC", 25: "SF", 26: "SEA", 27: "TB", 28: "WAS",
  29: "CAR", 30: "JAX", 33: "BAL", 34: "HOU",
};

// ESPN defaultPositionId -> ours (same mapping convex/espn/rankings.ts
// confirmed, plus 16 = D/ST).
const ESPN_POSITION_TO_OURS: Record<number, Doc<"players">["position"]> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  16: "DST",
};

interface EspnRosterPlayer {
  espnId: number;
  name: string;
  position?: string;
  proTeamId?: number;
}

function extractRosterPlayers(team: EspnTeam): EspnRosterPlayer[] {
  return (team.roster?.entries ?? []).map((entry) => {
    const player = entry.playerPoolEntry?.player;
    const position =
      player?.defaultPositionId !== undefined
        ? ESPN_POSITION_TO_OURS[player.defaultPositionId]
        : undefined;
    return {
      espnId: entry.playerId,
      name: player?.fullName ?? "",
      ...(position ? { position } : {}),
      ...(player?.proTeamId !== undefined ? { proTeamId: player.proTeamId } : {}),
    };
  });
}

// ESPN player id -> fpid. Primary path is the exact players.by_espn_id join
// (Sleeper's own espn_id crosswalk - see schema.ts's players.espnId); D/ST
// goes through proTeamId instead, and anyone the crosswalk misses (rookies
// before Sleeper backfills their espn_id, mostly) falls back to the same
// normalized name+position match convex/espn/rankings.ts uses.
export const resolveEspnPlayersToFpids = internalQuery({
  args: {
    players: v.array(
      v.object({
        espnId: v.number(),
        name: v.string(),
        position: v.optional(v.string()),
        proTeamId: v.optional(v.number()),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Array<{ espnId: number; fpid: number }>> => {
    const matches: Array<{ espnId: number; fpid: number }> = [];
    const misses: typeof args.players = [];
    for (const player of args.players) {
      if (player.position === "DST") {
        const abbr =
          player.proTeamId !== undefined
            ? ESPN_PRO_TEAM_ABBR[player.proTeamId]
            : undefined;
        const fpid = abbr ? DEF_TEAM_FPIDS[abbr] : undefined;
        if (fpid !== undefined) matches.push({ espnId: player.espnId, fpid });
        continue;
      }
      const linked = await ctx.db
        .query("players")
        .withIndex("by_espn_id", (q) => q.eq("espnId", player.espnId))
        .first();
      if (linked) {
        matches.push({ espnId: player.espnId, fpid: linked.fpid });
      } else {
        misses.push(player);
      }
    }

    if (misses.length > 0) {
      const byNameAndPosition = new Map<string, number>();
      for (const player of await ctx.db.query("players").collect()) {
        byNameAndPosition.set(
          `${normalizePlayerName(player.name)}|${player.position}`,
          player.fpid,
        );
      }
      for (const player of misses) {
        if (!player.position || !player.name) continue;
        const fpid = byNameAndPosition.get(
          `${normalizePlayerName(player.name)}|${player.position}`,
        );
        if (fpid !== undefined) matches.push({ espnId: player.espnId, fpid });
      }
    }
    return matches;
  },
});

export interface EspnTeamRow {
  teamId: string;
  teamName: string;
  ownerName: string | undefined;
}

function teamRows(league: EspnLeague): EspnTeamRow[] {
  const memberById = new Map((league.members ?? []).map((m) => [m.id, m]));
  return (league.teams ?? []).map((team) => ({
    teamId: String(team.id),
    teamName: espnTeamName(team),
    ownerName: espnMemberName(
      team.primaryOwner ? memberById.get(team.primaryOwner) : undefined,
    ),
  }));
}

export interface EspnImportPreview {
  espnLeagueId: string;
  name: string;
  season: string;
  teamCount: number;
  // Undefined for an ESPN draft type this app has no equivalent for - the
  // wizard falls back to auction, same as Sleeper's preview.
  draftType: DraftType | undefined;
  scoring: Scoring;
  teScoring: TeScoring;
  sixPointPassTds: boolean;
  rosterSlots: MappedRosterSlots["rosterSlots"];
  flexPositions: MappedRosterSlots["flexPositions"];
  superflexPositions: MappedRosterSlots["superflexPositions"];
  droppedSlots: string[];
  teams: EspnTeamRow[];
}

// Powers every app's "Add League > ESPN" wizard - one round trip for the
// settings to pre-fill and the team list to map. No auth check, same as
// previewSleeperImport: it only reads ESPN's own public data. Takes the raw
// user input (id or pasted URL) and returns the parsed id, so the wizard
// never has to parse ESPN URLs itself. No ESPN-account concept exists to
// pre-select "which team is me", so the wizard asks.
export const previewEspnImport = action({
  args: { leagueInput: v.string() },
  handler: async (_ctx, args): Promise<EspnImportPreview> => {
    const espnLeagueId = parseEspnLeagueId(args.leagueInput);
    const season = currentSeason();
    const league = await fetchEspnLeague(espnLeagueId, season, [
      "mSettings",
      "mTeam",
    ]);
    const settings = league.settings;
    if (!settings) {
      throw new Error("ESPN didn't return settings for this league.");
    }
    const mapped = mapEspnRosterSlots(settings.rosterSettings?.lineupSlotCounts);
    const teams = teamRows(league);
    return {
      espnLeagueId,
      name: settings.name,
      season,
      teamCount: settings.size || teams.length,
      draftType: mapEspnDraftType(settings.draftSettings),
      scoring: mapEspnScoring(settings.scoringSettings),
      teScoring: mapEspnTeScoring(settings.scoringSettings),
      sixPointPassTds: mapEspnSixPointPassTds(settings.scoringSettings),
      rosterSlots: mapped.rosterSlots,
      flexPositions: mapped.flexPositions,
      superflexPositions: mapped.superflexPositions,
      droppedSlots: mapped.droppedSlots,
      teams,
    };
  },
});

// infinidraft's Season Settings team-mapping step (for a league linked
// after creation rather than through the import wizard).
export const fetchEspnLeagueTeams = action({
  args: { espnLeagueId: v.string() },
  handler: async (_ctx, args): Promise<EspnTeamRow[]> => {
    const league = await fetchEspnLeague(args.espnLeagueId, currentSeason(), [
      "mTeam",
    ]);
    return teamRows(league);
  },
});

// Pulls every mapped team's roster, FAAB spend, record and waiver rank from
// the linked ESPN league in one request (unlike Yahoo's per-team calls) and
// writes them through the same shared rosterSync.ts path as the Sleeper/
// Yahoo syncs. Reads the season's own year as ESPN's seasonId, since ESPN
// keeps one league id across seasons.
export const syncEspnLeagueRoster = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx: ActionCtx, args): Promise<{ syncedTeams: number }> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.espnLeagueId) {
      throw new Error("This league isn't linked to an ESPN league yet.");
    }

    const league = await fetchEspnLeague(season.espnLeagueId, season.year, [
      "mSettings",
      "mTeam",
      "mRoster",
      "mStandings",
    ]);
    const acquisition = league.settings?.acquisitionSettings;
    const waiverType = mapEspnWaiverType(acquisition);

    // Re-read every sync, same self-healing rationale as Sleeper's. Unlike
    // Yahoo, ESPN reports the real league-wide FAAB budget.
    await ctx.runMutation(internal.rosterSync.updateSeasonWaiverSettings, {
      seasonId: args.seasonId,
      waiverType,
      ...(waiverType === "faab" && acquisition?.acquisitionBudget !== undefined
        ? { faabBudget: acquisition.acquisitionBudget }
        : {}),
    });

    const espnTeamById = new Map(
      (league.teams ?? []).map((team) => [String(team.id), team]),
    );
    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );
    const linked = teams.flatMap((team) => {
      const espnTeam = team.espnTeamId
        ? espnTeamById.get(team.espnTeamId)
        : undefined;
      return espnTeam ? [{ team, espnTeam }] : [];
    });

    // One resolution pass across every roster, so the name-match fallback's
    // full players scan happens at most once per sync.
    const resolved: Array<{ espnId: number; fpid: number }> = await ctx.runQuery(
      internal.espn.league.resolveEspnPlayersToFpids,
      { players: linked.flatMap(({ espnTeam }) => extractRosterPlayers(espnTeam)) },
    );
    const fpidByEspnId = new Map(resolved.map((r) => [r.espnId, r.fpid]));

    for (const { team, espnTeam } of linked) {
      const fpids = (espnTeam.roster?.entries ?? [])
        .map((entry) => fpidByEspnId.get(entry.playerId))
        .filter((fpid): fpid is number => fpid !== undefined);
      const record = espnTeam.record?.overall;
      await ctx.runMutation(internal.rosterSync.replaceRosterForTeam, {
        seasonId: args.seasonId,
        teamId: team._id as Id<"seasonTeams">,
        fpids,
        faabSpent: espnTeam.transactionCounter?.acquisitionBudgetSpent ?? 0,
        wins: record?.wins ?? 0,
        losses: record?.losses ?? 0,
        ties: record?.ties ?? 0,
        pointsFor: record?.pointsFor ?? 0,
        pointsAgainst: record?.pointsAgainst ?? 0,
        ...(waiverType === "priority" && espnTeam.waiverRank !== undefined
          ? { waiverPosition: espnTeam.waiverRank }
          : {}),
        name: espnTeamName(espnTeam),
      });
    }

    return { syncedTeams: linked.length };
  },
});

// Who an ESPN team plays in a given week, for infinileague's Matchup tab.
// mMatchupScore is the lightest view that still carries the full schedule.
// Regular-season matchupPeriodId lines up 1:1 with the NFL week; a league
// with multi-week playoff rounds won't match there, which just falls back
// to null (manual opponent pick), same as a bye.
export async function fetchEspnOpponentTeamId(
  espnLeagueId: string,
  season: string,
  week: string,
  espnTeamId: string,
): Promise<string | null> {
  const league = await fetchEspnLeague(espnLeagueId, season, ["mMatchupScore"]);
  const selfId = Number(espnTeamId);
  for (const matchup of league.schedule ?? []) {
    if (String(matchup.matchupPeriodId) !== week) continue;
    const home = matchup.home?.teamId;
    const away = matchup.away?.teamId;
    if (home === selfId) return away !== undefined ? String(away) : null;
    if (away === selfId) return home !== undefined ? String(home) : null;
  }
  return null;
}

export interface EspnWeekEntry {
  espnId: number;
  name: string;
  position?: string;
  proTeamId?: number;
  lineupSlotId: number;
  actualPoints?: number;
}

// One team's lineup for a given week, for infinileague's team page.
// Passing scoringPeriodId makes mRoster return the roster/lineup as it stood
// that week (confirmed live - a past week shows that week's starters, not
// today's), and each player's stats then include that week's actual block
// (statSourceId 0, absent until they've played) with appliedTotal already in
// the league's own scoring - the ESPN counterpart to Sleeper's
// players_points.
export async function fetchEspnTeamWeekEntries(
  espnLeagueId: string,
  season: string,
  week: string,
  espnTeamId: string,
): Promise<EspnWeekEntry[]> {
  const league = await fetchEspnLeague(espnLeagueId, season, ["mRoster"], {
    scoringPeriodId: week,
  });
  const team = (league.teams ?? []).find((t) => String(t.id) === espnTeamId);
  if (!team) return [];
  const rosterPlayers = new Map(
    extractRosterPlayers(team).map((player) => [player.espnId, player]),
  );
  return (team.roster?.entries ?? []).map((entry) => {
    const actual = entry.playerPoolEntry?.player?.stats?.find(
      (block) =>
        block.statSourceId === 0 &&
        String(block.seasonId) === season &&
        String(block.scoringPeriodId) === week,
    );
    const player = rosterPlayers.get(entry.playerId);
    return {
      espnId: entry.playerId,
      name: player?.name ?? "",
      ...(player?.position ? { position: player.position } : {}),
      ...(player?.proTeamId !== undefined ? { proTeamId: player.proTeamId } : {}),
      lineupSlotId: entry.lineupSlotId,
      ...(actual?.appliedTotal !== undefined
        ? { actualPoints: actual.appliedTotal }
        : {}),
    };
  });
}
