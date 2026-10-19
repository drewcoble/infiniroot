import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  fetchSleeperJson,
  fetchSleeperLeagueSettings,
  sleeperPlayerIdToFpid,
  type SleeperRoster,
} from "../../sleeper/league";
import { SLOT_CODE_MAP, mapRosterPositions } from "../../sleeper/leagueSettingsMapping";
import type { POSITIONS } from "../../positions";
import { withYahooToken } from "../../infinidraft/yahoo/oauth";
import { fetchEspnTeamWeekEntries } from "../../espn/league";
import { ESPN_IR_SLOT_ID, ESPN_SLOT_MAP } from "../../espn/leagueSettingsMapping";
import { fetchYahooApi, findNodesByKey, mergeYahooFields } from "../../infinidraft/yahoo/client";
import { fetchYahooLeagueSettings } from "../../infinidraft/yahoo/league";
import { mapYahooDstScoring } from "../../infinidraft/yahoo/leagueSettingsMapping";
import { cachedYahoo } from "../../infinidraft/yahoo/cache";
import {
  dstProjection,
  hasAllowedTiers,
  sleeperDstScoring,
  type AllowedTier,
  type DstScoring,
} from "../../lib/dstScoring";

// How long a Yahoo league's DST scoring (from its settings) is reused - see
// infinidraft/yahoo/cache.ts.
const YAHOO_SETTINGS_CACHE_MS = 12 * 60 * 60 * 1000;

type Position = (typeof POSITIONS)[number];

// Sleeper's per-week matchup entry - verified live against the real
// connected league (GET /league/{id}/matchups/{week}), including for a
// week that hasn't happened yet (it just mirrors the current roster with
// 0 points - see this feature's plan doc). `players`/`starters` are native
// Sleeper player ids, not fpids. Exported so matchup.ts's getOpponentForWeek
// can read matchup_id off the same shape rather than redeclaring it -
// Sleeper groups exactly two roster_ids under one matchup_id per week
// (documented behavior, null/absent means that roster has a bye).
export interface SleeperMatchupEntry {
  roster_id: number;
  players: string[] | null;
  starters: string[] | null;
  players_points?: Record<string, number>;
  matchup_id?: number | null;
}

// Same canonical slot ordering as infinidraft's own src/lib/rosterSlots.ts
// SLOT_ORDER (the "My Team" tab) - kept in sync deliberately, so a roster
// reads the same way in both apps. "FLEX"/"SUPERFLEX" cover any Sleeper
// flex-shaped slot code (WRRB_FLEX, REC_FLEX, etc. all collapse to "FLEX",
// same simplification convex/sleeper/leagueSettingsMapping.ts's
// mapRosterPositions already makes at import time).
export type SlotLabel =
  | "QB"
  | "SUPERFLEX"
  | "RB"
  | "WR"
  | "FLEX"
  | "TE"
  | "DST"
  | "K"
  | "BENCH"
  | "IR"
  | "TAXI";

// Yahoo's roster entries carry a `selected_position` field per player -
// which slot THIS player occupies for this specific week (a starting
// position, "BN" for bench, or "IR"/"IR+") - same code vocabulary
// convex/infinidraft/yahoo/leagueSettingsMapping.ts's SLOT_CODE_MAP uses for
// league-wide roster_positions counts, except IR/IR+ map to a real "IR" row
// here rather than being dropped - matching how the Sleeper branch below
// surfaces "who's actually on IR" as its own bucket rather than a counted
// slot. NOT confirmed against a live response - see YAHOO.md.
const YAHOO_SELECTED_POSITION_MAP: Record<string, SlotLabel> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
  K: "K",
  "W/R/T": "FLEX",
  "W/T": "FLEX",
  "R/W": "FLEX",
  "Q/W/R/T": "SUPERFLEX",
  BN: "BENCH",
  IR: "IR",
  "IR+": "IR",
};

const SLOT_ORDER_RANK: Record<SlotLabel, number> = {
  QB: 0,
  SUPERFLEX: 1,
  RB: 2,
  WR: 3,
  FLEX: 4,
  TE: 5,
  DST: 6,
  K: 7,
  BENCH: 8,
  IR: 9,
  TAXI: 10,
};

export interface TeamRosterRow {
  // Absent for an unfilled roster slot (an open starter/bench/taxi spot
  // per the league's own configured counts) - still emitted as a row so
  // the slot itself doesn't just disappear from the page.
  fpid?: number;
  name?: string;
  position?: Position;
  team?: string | null;
  byeWeek?: number;
  isRookie?: boolean;
  injury?: { status: string; statusShort: string };
  // Absent only when the team isn't Sleeper-linked (no per-week matchup
  // source to read a starting lineup from at all).
  slot?: SlotLabel;
  // Live/actual points scored this week - Sleeper's players_points or
  // Yahoo's player_points.total (see the two branches above). Absent for a
  // team linked to neither provider, or a player/week neither returned a
  // value for.
  actualPoints?: number;
  // Absent whenever this week simply hasn't been projected yet. A DST's is
  // scored with its league's own DST scoring when that could be read (see
  // dstScoring below), not the projections table's default-scored one.
  projectedPoints?: number;
  // DST only, and only when the league's allowed tiers could be read -
  // what infinileague's live DST projection needs on top of the points
  // above (see its src/lib/liveGames.ts).
  dstScoring?: DstLiveScoring;
}

export interface DstLiveScoring {
  pointsTiers: AllowedTier[];
  yardsTiers: AllowedTier[];
  // Allowed so far this week, per Sleeper's live stats - read in the same
  // load as actualPoints so the two stay in step. Absent when the live poll
  // has no entry for this defense (before kickoff, or a past week whose
  // live copy has been pruned).
  allowed?: { points: number; yards: number };
  // projectedPoints' breakdown - see lib/dstScoring.ts's dstProjection.
  projectedPlays: number;
  projectedPointsAllowed: number;
  projectedYardsAllowed: number;
}

// Maps each starters[] entry to the actual slot it's occupying, via the
// league's own roster_positions (same order Sleeper lists every roster
// spot in, bench included) filtered down to just the starting spots -
// starters[i] corresponds 1:1 with the i-th non-bench entry in
// roster_positions. Falls back to "BENCH" on any length mismatch (should
// never happen against Sleeper's real behavior, but this is display logic,
// not worth throwing over).
function buildStartingSlotSequence(rosterPositions: string[]): SlotLabel[] {
  const sequence: SlotLabel[] = [];
  for (const code of rosterPositions) {
    const mapped = SLOT_CODE_MAP[code];
    if (!mapped || mapped === "BENCH") continue;
    sequence.push(mapped);
  }
  return sequence;
}

// One data path for every week, past/current/future - Sleeper's own
// per-week response already does the right thing for a future/not-yet-
// played week (verified live), so there's no "is this the current week"
// branch to write ourselves. An action (not a query) because of the live
// external fetch on the Sleeper-linked path.
export const getTeamRosterForWeek = action({
  args: { teamId: v.id("seasonTeams"), week: v.string() },
  handler: async (ctx: ActionCtx, args): Promise<TeamRosterRow[]> => {
    const owned = await ctx.runQuery(
      internal.infinileague.season.rosterPlayers.requireOwnedTeamForRead,
      { teamId: args.teamId },
    );
    return await loadTeamRosterForWeek(ctx, owned, args.week);
  },
});

// getTeamRosterForWeek's body, minus the ownership check - exported so
// eliminationWatch.ts can load every team's lineup for its live ranking
// after checking access to the whole season once.
export async function loadTeamRosterForWeek(
  ctx: ActionCtx,
  {
    team,
    season,
    league,
  }: { team: Doc<"seasonTeams">; season: Doc<"seasons">; league: Doc<"leagues"> },
  week: string,
): Promise<TeamRosterRow[]> {

  const isSleeperLinked = Boolean(team.sleeperRosterId && season.sleeperLeagueId);
  const isYahooLinked = Boolean(team.yahooTeamKey && season.yahooLeagueKey);
  const isEspnLinked = Boolean(team.espnTeamId && season.espnLeagueId);

  // One entry per physical roster slot the league is configured for -
  // starters 1:1 via startingSlotSequence, then however many bench/IR/taxi
  // slots the league's own settings define, empty ones included (null
  // playerId) - so the team page always shows every slot Sleeper's own
  // roster view would, not just however many players happen to be
  // rostered right now. Only ever populated on the Sleeper-linked path;
  // the Yahoo/fallback paths below have no such fixed-slot-count source,
  // so they only ever show slots for players actually rostered.
  let assignments: { slot: SlotLabel; playerId: string | null }[] = [];
  let fpids: number[] = [];
  // Yahoo/ESPN counterpart to `assignments` above - keyed by fpid instead
  // of Sleeper's native player id, and only ever has entries for players
  // actually rostered (no empty-slot placeholders, see above).
  let slotByFpid: Map<number, SlotLabel> | undefined;
  // Yahoo counterpart to actualPointsBySleeperId below - keyed by fpid
  // (resolved from Yahoo's player_key the same way slotByFpid is)
  // rather than Sleeper's native player id.
  let actualPointsByFpid: Map<number, number> | undefined;
  const actualPointsBySleeperId = new Map<string, number>();
  // The league's DST scoring, from whichever provider's settings this
  // load already reads (or, for Yahoo, one extra settings call).
  let dstScoring: DstScoring | undefined;

  if (isSleeperLinked && team.sleeperRosterId && season.sleeperLeagueId) {
    const [matchups, leagueSettings, rosters] = await Promise.all([
      fetchSleeperJson<SleeperMatchupEntry[]>(
        `/league/${season.sleeperLeagueId}/matchups/${week}`,
      ),
      fetchSleeperLeagueSettings(season.sleeperLeagueId),
      fetchSleeperJson<SleeperRoster[]>(`/league/${season.sleeperLeagueId}/rosters`),
    ]);
    const entry = matchups.find(
      (m) => String(m.roster_id) === team.sleeperRosterId,
    );
    const roster = rosters.find(
      (r) => String(r.roster_id) === team.sleeperRosterId,
    );

    // Taxi/IR membership is per-roster, not per-week matchup data (see
    // sleeper/league.ts's SleeperRoster.taxi/reserve) - both are subsets
    // of entry.players that never appear in starters, so they have to be
    // excluded explicitly or they'd fall into the bench bucket below.
    dstScoring = sleeperDstScoring(leagueSettings.scoring_settings);

    const taxiIds = new Set(roster?.taxi ?? []);
    const reserveIds = new Set(roster?.reserve ?? []);
    const startingSlotSequence = buildStartingSlotSequence(
      leagueSettings.roster_positions,
    );
    const starters = entry?.starters ?? [];
    // Sleeper marks an unfilled starter slot with the literal string "0"
    // rather than omitting the array index (verified live) - a missing
    // index (starters shorter than roster_positions) shouldn't happen
    // against Sleeper's real behavior either, but is treated the same way
    // rather than thrown over.
    const startingPlayerId = (index: number): string | null => {
      const id = starters[index];
      return id && id !== "0" ? id : null;
    };
    const startingIds = new Set(starters);
    const benchPlayerIds = (entry?.players ?? []).filter(
      (id) => !startingIds.has(id) && !taxiIds.has(id) && !reserveIds.has(id),
    );
    const benchSlotCount = mapRosterPositions(
      leagueSettings.roster_positions,
    ).rosterSlots.BENCH;
    const taxiSlotCount = leagueSettings.settings?.taxi_slots ?? 0;

    assignments = [
      ...startingSlotSequence.map((slot, i) => ({
        slot,
        playerId: startingPlayerId(i),
      })),
      ...Array.from({ length: benchSlotCount }, (_, i) => ({
        slot: "BENCH" as const,
        playerId: benchPlayerIds[i] ?? null,
      })),
      // IR isn't a counted/configurable-empty slot the way bench/taxi are
      // above (Sleeper doesn't report "how many IR spots are open," only
      // who's currently on IR) - just the players actually on it.
      ...[...reserveIds].map((playerId) => ({ slot: "IR" as const, playerId })),
      ...Array.from({ length: taxiSlotCount }, (_, i) => ({
        slot: "TAXI" as const,
        playerId: [...taxiIds][i] ?? null,
      })),
    ];

    const rawPoints = entry?.players_points ?? {};
    for (const { playerId } of assignments) {
      if (playerId === null) continue;
      const fpid = sleeperPlayerIdToFpid(playerId);
      if (fpid === null) continue;
      fpids.push(fpid);
      if (rawPoints[playerId] !== undefined) {
        actualPointsBySleeperId.set(playerId, rawPoints[playerId]);
      }
    }
  } else if (isYahooLinked && team.yahooTeamKey && season.yahooLeagueKey) {
    // Yahoo's roster resource supports a per-week sub-resource selector
    // (`;week=`, same `;status=W` pattern convex/infinidraft/yahoo/waivers.ts
    // uses) - each player node carries a `selected_position` field for
    // that week (starting slot, "BN", or "IR"/"IR+" - see
    // YAHOO_SELECTED_POSITION_MAP above). Chaining `/players/stats;type=week;week=`
    // onto the same request additionally nests a `player_points` field
    // (field-list pattern, `{coverage_type, week, total}`) onto each player
    // node - `total` is this app's own league scoring already applied by
    // Yahoo, the per-player counterpart to Sleeper's players_points, and
    // (per general knowledge of the Fantasy Sports API) updates live during
    // games the same way the scoreboard's team_points does. NOT confirmed
    // against a live response - see YAHOO.md. No fixed-slot-count source
    // exists here (unlike Sleeper's roster_positions), so this only ever
    // produces rows for players actually rostered this week.
    const yahooLeagueKey = season.yahooLeagueKey;
    const [rosterJson, yahooDstScoring] = await withYahooToken(ctx, league.ownerId, (accessToken) =>
      Promise.all([
        fetchYahooApi<unknown>(
          accessToken,
          `/team/${team.yahooTeamKey}/roster;week=${week}/players/stats;type=week;week=${week}`,
        ),
        // Only for the DST allowed tiers, which only a commissioner's edit
        // changes - cached rather than refetched with every roster load and
        // live refresh. A failure with nothing cached just leaves the live
        // DST projection on its tier-less fallback.
        cachedYahoo(ctx, `dst:${yahooLeagueKey}`, YAHOO_SETTINGS_CACHE_MS, async () =>
          mapYahooDstScoring((await fetchYahooLeagueSettings(accessToken, yahooLeagueKey)).raw),
        ).catch((error: unknown) => {
          console.error("getTeamRosterForWeek (Yahoo): settings fetch failed", error);
          return undefined;
        }),
      ]),
    );
    if (yahooDstScoring !== undefined) dstScoring = yahooDstScoring;
    const rosterEntries = findNodesByKey(rosterJson, "player")
      .map((node) => {
        const fields = mergeYahooFields(node);
        const playerKey = typeof fields.player_key === "string" ? fields.player_key : undefined;
        const nameField = fields.name as { full?: string } | undefined;
        const fullName = nameField?.full;
        const position = fields.display_position;
        const teamAbbr =
          typeof fields.editorial_team_abbr === "string"
            ? fields.editorial_team_abbr
            : undefined;
        const selectedPositionFields = mergeYahooFields(fields.selected_position);
        const positionCode =
          typeof selectedPositionFields.position === "string"
            ? selectedPositionFields.position
            : undefined;
        const pointsFields = mergeYahooFields(fields.player_points);
        const actualPoints =
          pointsFields.total !== undefined && pointsFields.total !== null
            ? Number(pointsFields.total)
            : undefined;
        if (!playerKey || typeof fullName !== "string" || typeof position !== "string") {
          return null;
        }
        return {
          playerKey,
          name: fullName,
          position,
          teamAbbr,
          slot: positionCode ? YAHOO_SELECTED_POSITION_MAP[positionCode] : undefined,
          actualPoints: Number.isFinite(actualPoints) ? actualPoints : undefined,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    if (rosterEntries.length === 0 || rosterEntries.every((e) => e.slot === undefined)) {
      // Diagnostic for an unconfirmed shape - remove once checked against
      // a real response and this stops happening.
      console.error(
        "getTeamRosterForWeek (Yahoo): no players or no slots resolved, raw response:",
        JSON.stringify(rosterJson),
      );
    }
    if (rosterEntries.length > 0 && rosterEntries.every((e) => e.actualPoints === undefined)) {
      // Diagnostic for an unconfirmed shape - remove once checked against
      // a real response and this stops happening. Not necessarily a bug on
      // its own (a week with no games played yet reads 0 the same as
      // "missing", per Sleeper's own behavior) - worth checking the raw
      // player_points shape if this fires during a live game window.
      console.error(
        "getTeamRosterForWeek (Yahoo): no player_points resolved, raw response:",
        JSON.stringify(rosterJson),
      );
    }

    const resolved: Array<{ playerKey: string; fpid: number }> = await ctx.runQuery(
      internal.infinidraft.yahoo.league.resolvePlayerKeysToFpids,
      {
        players: rosterEntries.map(({ playerKey, name, position, teamAbbr }) => ({
          playerKey,
          name,
          position,
          ...(teamAbbr ? { teamAbbr } : {}),
        })),
      },
    );
    const fpidByPlayerKey = new Map(resolved.map((r) => [r.playerKey, r.fpid]));

    slotByFpid = new Map();
    actualPointsByFpid = new Map();
    for (const entry of rosterEntries) {
      const fpid = fpidByPlayerKey.get(entry.playerKey);
      if (fpid === undefined) continue;
      fpids.push(fpid);
      if (entry.slot !== undefined) slotByFpid.set(fpid, entry.slot);
      if (entry.actualPoints !== undefined) actualPointsByFpid.set(fpid, entry.actualPoints);
    }
  } else if (isEspnLinked && team.espnTeamId && season.espnLeagueId) {
    // ESPN's lineup for this specific week (see fetchEspnTeamWeekEntries) -
    // lineupSlotId maps through the same ESPN_SLOT_MAP the import uses
    // (narrow flexes -> FLEX, OP -> SUPERFLEX), plus IR as its own row.
    // Only players actually rostered, same as the Yahoo path.
    const espnWeek = await fetchEspnTeamWeekEntries(
      season.espnLeagueId,
      season.year,
      week,
      team.espnTeamId,
    );
    const entries = espnWeek.entries;
    dstScoring = espnWeek.dstScoring;
    const resolved: Array<{ espnId: number; fpid: number }> = await ctx.runQuery(
      internal.espn.league.resolveEspnPlayersToFpids,
      {
        players: entries.map(({ espnId, name, position, proTeamId }) => ({
          espnId,
          name,
          ...(position ? { position } : {}),
          ...(proTeamId !== undefined ? { proTeamId } : {}),
        })),
      },
    );
    const fpidByEspnId = new Map(resolved.map((r) => [r.espnId, r.fpid]));

    slotByFpid = new Map();
    actualPointsByFpid = new Map();
    for (const entry of entries) {
      const fpid = fpidByEspnId.get(entry.espnId);
      if (fpid === undefined) continue;
      fpids.push(fpid);
      const slot: SlotLabel | undefined =
        entry.lineupSlotId === ESPN_IR_SLOT_ID
          ? "IR"
          : ESPN_SLOT_MAP[entry.lineupSlotId];
      if (slot !== undefined) slotByFpid.set(fpid, slot);
      if (entry.actualPoints !== undefined) actualPointsByFpid.set(fpid, entry.actualPoints);
    }
  } else {
    // Not linked to any provider - no per-week matchup source at all,
    // fall back to whatever the last roster sync stored. Shouldn't
    // normally happen for a season infinileague can see (those are always
    // provider-linked - see convex/leagues.ts's listLinkedSeasons), but
    // handled rather than left to throw. No slot structure here, so no
    // empty-slot rows either - just whatever's actually rostered.
    fpids = await ctx.runQuery(
      internal.infinileague.season.rosterPlayers.listRosterFpidsForTeam,
      { teamId: team._id },
    );
  }

  const leagueDstScoring = dstScoring && hasAllowedTiers(dstScoring) ? dstScoring : undefined;
  const [players, byeWeeks, weekProjections, liveDstAllowed] = await Promise.all([
    ctx.runQuery(api.players.getPlayersByFpids, { fpids }),
    ctx.runQuery(api.nflSchedule.getByeWeeks, {}),
    ctx.runQuery(api.projections.getAllProjections, { week: week }),
    leagueDstScoring
      ? ctx.runQuery(internal.sleeper.livePoints.getLiveDstAllowed, { season: season.year, week })
      : Promise.resolve([]),
  ]);

  // The designation for the week being viewed - see weekInjuries.ts
  // (status at kickoff for past weeks, live for the current week, only IR
  // carried into future weeks).
  const weekInjuries = await ctx.runQuery(
    internal.infinileague.season.weekInjuries.getInjuriesForWeek,
    {
      week: week,
      players: players.map((player) => ({ fpid: player.fpid, team: player.team ?? null })),
    },
  );
  const injuryByFpid = new Map(weekInjuries.map((row) => [row.fpid, row]));
  const projectionByFpid = new Map(
    weekProjections.map((row) => [row.fpid, row]),
  );
  const playerByFpid = new Map(players.map((player) => [player.fpid, player]));
  const liveDstAllowedByFpid = new Map(liveDstAllowed.map((entry) => [entry.fpid, entry]));

  function buildFilledRow(
    fpid: number,
    slot: SlotLabel | undefined,
    actualPoints: number | undefined,
  ): TeamRosterRow | null {
    const player = playerByFpid.get(fpid);
    if (!player) return null;
    const injury = injuryByFpid.get(fpid);
    const projection = projectionByFpid.get(fpid);
    let projectedPoints = projection
      ? season.scoring === "PPR"
        ? projection.pointsPpr
        : season.scoring === "HALF"
          ? projection.pointsHalf
          : projection.pointsStd
      : undefined;
    const byeWeek = player.team ? byeWeeks[player.team] : undefined;
    let dstLiveScoring: DstLiveScoring | undefined;
    if (
      player.position === "DST" &&
      leagueDstScoring &&
      projection &&
      projectedPoints !== undefined
    ) {
      const live = liveDstAllowedByFpid.get(fpid);
      const dst = dstProjection(leagueDstScoring, projection.stats, projectedPoints);
      projectedPoints = dst.projectedPoints;
      dstLiveScoring = {
        pointsTiers: leagueDstScoring.pointsTiers,
        yardsTiers: leagueDstScoring.yardsTiers,
        ...(live ? { allowed: { points: live.ptsAllow, yards: live.ydsAllow } } : {}),
        projectedPlays: dst.projectedPlays,
        projectedPointsAllowed: dst.projectedPointsAllowed,
        projectedYardsAllowed: dst.projectedYardsAllowed,
      };
    }

    return {
      fpid,
      name: player.name,
      position: player.position,
      team: player.team,
      isRookie: player.yearsExp === 0,
      ...(byeWeek !== undefined ? { byeWeek } : {}),
      ...(injury
        ? { injury: { status: injury.status, statusShort: injury.statusShort } }
        : {}),
      ...(slot !== undefined ? { slot } : {}),
      ...(actualPoints !== undefined ? { actualPoints } : {}),
      ...(projectedPoints !== undefined ? { projectedPoints } : {}),
      ...(dstLiveScoring ? { dstScoring: dstLiveScoring } : {}),
    };
  }

  const rows: TeamRosterRow[] = isSleeperLinked
    ? assignments.map(({ slot, playerId }): TeamRosterRow => {
        if (playerId === null) return { slot };
        const fpid = sleeperPlayerIdToFpid(playerId);
        const filled =
          fpid !== null
            ? buildFilledRow(fpid, slot, actualPointsBySleeperId.get(playerId))
            : null;
        return filled ?? { slot };
      })
    : fpids
        .map((fpid) =>
          buildFilledRow(fpid, slotByFpid?.get(fpid), actualPointsByFpid?.get(fpid)),
        )
        .filter((row): row is TeamRosterRow => row !== null);

  // Same canonical order as infinidraft's My Team tab - see SLOT_ORDER_RANK.
  // Stable sort keeps each slot bucket's own construction order (filled
  // slots before the empty ones appended after them above).
  return rows.sort(
    (a, b) => SLOT_ORDER_RANK[a.slot ?? "BENCH"] - SLOT_ORDER_RANK[b.slot ?? "BENCH"],
  );
}
