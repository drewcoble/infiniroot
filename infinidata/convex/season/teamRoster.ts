import { v } from "convex/values";
import { action, ActionCtx } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { fetchSleeperJson, fetchSleeperLeagueSettings, sleeperPlayerIdToFpid } from "../sleeper/league";
import { SLOT_CODE_MAP } from "../sleeper/leagueSettingsMapping";
import type { POSITIONS } from "../positions";

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
  | "BENCH";

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
};

export interface TeamRosterRow {
  fpid: number;
  name: string;
  position: Position;
  team: string | null;
  byeWeek?: number;
  isRookie: boolean;
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
      internal.season.rosterPlayers.requireOwnedTeamForRead,
      { teamId: args.teamId },
    );

    const fpids: number[] = [];
    const slotByFpid = new Map<number, SlotLabel>();
    const actualPointsByFpid = new Map<number, number>();
    const isSleeperLinked = Boolean(team.sleeperRosterId && season.sleeperLeagueId);

    if (isSleeperLinked && team.sleeperRosterId && season.sleeperLeagueId) {
      const [matchups, leagueSettings] = await Promise.all([
        fetchSleeperJson<SleeperMatchupEntry[]>(
          `/league/${season.sleeperLeagueId}/matchups/${args.week}`,
        ),
        fetchSleeperLeagueSettings(season.sleeperLeagueId),
      ]);
      const entry = matchups.find(
        (m) => String(m.roster_id) === team.sleeperRosterId,
      );
      const startingSlotSequence = buildStartingSlotSequence(
        leagueSettings.roster_positions,
      );
      const starters = entry?.starters ?? [];
      const slotBySleeperId = new Map<string, SlotLabel>();
      starters.forEach((playerId, index) => {
        slotBySleeperId.set(playerId, startingSlotSequence[index] ?? "BENCH");
      });
      const rawPoints = entry?.players_points ?? {};

      for (const playerId of entry?.players ?? []) {
        const fpid = sleeperPlayerIdToFpid(playerId);
        if (fpid === null) continue;
        fpids.push(fpid);
        slotByFpid.set(fpid, slotBySleeperId.get(playerId) ?? "BENCH");
        if (rawPoints[playerId] !== undefined) {
          actualPointsByFpid.set(fpid, rawPoints[playerId]);
        }
      }
    } else {
      // Not Sleeper-linked - no per-week matchup source at all, fall back
      // to whatever the last roster sync stored. Shouldn't normally happen
      // for a season infinileague can see (those are always provider-
      // linked - see convex/leagues.ts's listLinkedSeasons), but handled
      // rather than left to throw.
      const rosterFpids: number[] = await ctx.runQuery(
        internal.season.rosterPlayers.listRosterFpidsForTeam,
        { teamId: args.teamId },
      );
      fpids.push(...rosterFpids);
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

    const rows: TeamRosterRow[] = players.map((player) => {
      const injury = injuryByFpid.get(player.fpid);
      const projection = projectionByFpid.get(player.fpid);
      const projectedPoints = projection
        ? season.scoring === "PPR"
          ? projection.pointsPpr
          : season.scoring === "HALF"
            ? projection.pointsHalf
            : projection.pointsStd
        : undefined;
      const byeWeek = player.team ? byeWeeks[player.team] : undefined;
      const actualPoints = actualPointsByFpid.get(player.fpid);
      const slot = slotByFpid.get(player.fpid);

      return {
        fpid: player.fpid,
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
    });

    // Same canonical order as infinidraft's My Team tab - see SLOT_ORDER_RANK.
    return rows.sort(
      (a, b) => SLOT_ORDER_RANK[a.slot ?? "BENCH"] - SLOT_ORDER_RANK[b.slot ?? "BENCH"],
    );
  },
});
