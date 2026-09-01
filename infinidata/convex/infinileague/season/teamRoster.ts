import { v } from "convex/values";
import { action, ActionCtx } from "../../_generated/server";
import { api, internal } from "../../_generated/api";
import {
  fetchSleeperJson,
  fetchSleeperLeagueSettings,
  sleeperPlayerIdToFpid,
  type SleeperRoster,
} from "../../sleeper/league";
import { SLOT_CODE_MAP, mapRosterPositions } from "../../sleeper/leagueSettingsMapping";
import type { POSITIONS } from "../../positions";

type Position = (typeof POSITIONS)[number];

// Sleeper's per-week matchup entry - verified live against the real
// connected league (GET /league/{id}/matchups/{week}), including for a
// week that hasn't happened yet (it just mirrors the current roster with
// 0 points - see this feature's plan doc). `players`/`starters` are native
// Sleeper player ids, not fpids.
interface SleeperMatchupEntry {
  roster_id: number;
  players: string[] | null;
  starters: string[] | null;
  players_points?: Record<string, number>;
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
  actualPoints?: number;
  // Absent whenever this week simply hasn't been projected yet.
  projectedPoints?: number;
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
    const { team, season } = await ctx.runQuery(
      internal.infinileague.season.rosterPlayers.requireOwnedTeamForRead,
      { teamId: args.teamId },
    );

    const isSleeperLinked = Boolean(team.sleeperRosterId && season.sleeperLeagueId);

    // One entry per physical roster slot the league is configured for -
    // starters 1:1 via startingSlotSequence, then however many bench/IR/taxi
    // slots the league's own settings define, empty ones included (null
    // playerId) - so the team page always shows every slot Sleeper's own
    // roster view would, not just however many players happen to be
    // rostered right now. Only ever populated on the Sleeper-linked path;
    // the fallback path below has no slot structure to build this from.
    let assignments: { slot: SlotLabel; playerId: string | null }[] = [];
    let fpids: number[] = [];
    const actualPointsBySleeperId = new Map<string, number>();

    if (isSleeperLinked && team.sleeperRosterId && season.sleeperLeagueId) {
      const [matchups, leagueSettings, rosters] = await Promise.all([
        fetchSleeperJson<SleeperMatchupEntry[]>(
          `/league/${season.sleeperLeagueId}/matchups/${args.week}`,
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
    } else {
      // Not Sleeper-linked - no per-week matchup source at all, fall back
      // to whatever the last roster sync stored. Shouldn't normally happen
      // for a season infinileague can see (those are always provider-
      // linked - see convex/leagues.ts's listLinkedSeasons), but handled
      // rather than left to throw. No slot structure here, so no empty-slot
      // rows either - just whatever's actually rostered.
      fpids = await ctx.runQuery(
        internal.infinileague.season.rosterPlayers.listRosterFpidsForTeam,
        { teamId: args.teamId },
      );
    }

    const [players, allInjuries, byeWeeks, weekProjections] = await Promise.all([
      ctx.runQuery(api.players.getPlayersByFpids, { fpids }),
      ctx.runQuery(api.injuries.getInjuries, {}),
      ctx.runQuery(api.nflSchedule.getByeWeeks, {}),
      ctx.runQuery(api.projections.getAllProjections, { week: args.week }),
    ]);

    const injuryByFpid = new Map(allInjuries.map((row) => [row.fpid, row]));
    const projectionByFpid = new Map(
      weekProjections.map((row) => [row.fpid, row]),
    );
    const playerByFpid = new Map(players.map((player) => [player.fpid, player]));

    function buildFilledRow(
      fpid: number,
      slot: SlotLabel | undefined,
      actualPoints: number | undefined,
    ): TeamRosterRow | null {
      const player = playerByFpid.get(fpid);
      if (!player) return null;
      const injury = injuryByFpid.get(fpid);
      const projection = projectionByFpid.get(fpid);
      const projectedPoints = projection
        ? season.scoring === "PPR"
          ? projection.pointsPpr
          : season.scoring === "HALF"
            ? projection.pointsHalf
            : projection.pointsStd
        : undefined;
      const byeWeek = player.team ? byeWeeks[player.team] : undefined;

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
        ...(isSleeperLinked && actualPoints !== undefined
          ? { actualPoints }
          : {}),
        ...(projectedPoints !== undefined ? { projectedPoints } : {}),
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
          .map((fpid) => buildFilledRow(fpid, undefined, undefined))
          .filter((row): row is TeamRosterRow => row !== null);

    // Same canonical order as infinidraft's My Team tab - see SLOT_ORDER_RANK.
    // Stable sort keeps each slot bucket's own construction order (filled
    // slots before the empty ones appended after them above).
    return rows.sort(
      (a, b) => SLOT_ORDER_RANK[a.slot ?? "BENCH"] - SLOT_ORDER_RANK[b.slot ?? "BENCH"],
    );
  },
});
