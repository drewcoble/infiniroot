import { v, type Infer } from "convex/values";
import { internalAction, internalMutation, internalQuery, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { POSITIONS, positionValidator } from "./positions";
import { scoringConfigFromSeason, scoringConfigValidator, type ScoringConfig } from "./scoring";
import { requireSeasonOwner } from "./lib/access";
import { loadWeekPoints } from "./lib/weekPoints";
import { computeReplacementLevels, findInjuryBoosts, forwardRate, gatherPlayerForms, momentumMultiplier, type ValuedPlayer } from "./lib/playerValue";
import { gatherRosProjTotals } from "./rosProjTotals";
import {
  ensureLeagueShapeId,
  findLeagueShapeId,
  leagueShapeFieldsValidator,
  leagueShapeOf,
  loadSeasonRosVorRows,
  type LeagueShapeFields,
} from "./lib/leagueShape";

type Position = (typeof POSITIONS)[number];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface RosVorRow {
  fpid: number;
  name: string;
  team: string | null;
  position: Position;
  // Raw underlying value - not meant for display (see schema.ts's comment
  // on why rank is the UI-facing number). Kept here for tooling/debugging
  // and for trade-evaluation math that wants the actual magnitude, not just
  // ordering.
  rosVor: number;
  rosRank: number;
  actualVor: number;
  actualRank: number;
  // This player's rank among just their own position (1 = the best RB,
  // best WR, etc.), by the same rosVor ordering rosRank uses globally -
  // "RB1", "TE16" style labels. Derived at read time in getRosVorBoard
  // (cheap - the row's own rosVor already tells us the order, no need to
  // store this alongside rosRank/actualRank the way those are).
  positionRank: number;
  // Display-facing per-game rates - see schema.ts's comment on why these
  // are computed once at write time rather than derived here from rosValue/
  // remainingWeeks (which only reflect the CURRENT week, wrong for a past
  // week's row).
  rosPpg: number;
  actualPpg: number;
  // Single-week counterpart to rosVor/rosRank/rosPpg above - "best play
  // this week specifically" rather than summed over the rest of the
  // season. See schema.ts's comment on rosVorBoardFields.weekVor for why this
  // isn't just rosVor/remainingWeeks.
  weekVor: number;
  weekRank: number;
  weekPpg: number;
  // Position rank derived from weekVor, same "computed at read time" reason
  // positionRank (rosVor-based) is - the week-mode counterpart to
  // positionRank for infinileague's Players tab toggle.
  weekPositionRank: number;
  // The fantasy team's own name (not the NFL team abbreviation above) -
  // null means this player is a free agent. Only populated by
  // getRosVorBoard, which joins against rosterPlayers/seasonTeams for
  // this; getPlayerRosVorHistory's raw rows don't have it.
  rosteredByTeamName: string | null;
  // Absent means not currently injured - same convex/injuries.ts table
  // (Sleeper-sourced, one row per currently-injured player) teamRoster.ts
  // already joins for the Trade tab's roster panel. Only populated by
  // getRosVorBoard, same as rosteredByTeamName above.
  injury?: { status: string; statusShort: string };
  // True when this player is rostered by the teamId getRosVorBoard was
  // called with (see its optional teamId arg) - false whenever that arg is
  // omitted, not just for other teams' players, so callers that don't pass
  // a teamId (getPlayerRosVorHistory's raw rows, or a caller with no "my
  // team" context yet) get a row that never claims false ownership. Powers
  // infinileague's Players tab own-roster highlight (PlayerCard.tsx).
  isOnMyTeam: boolean;
}

// Recomputes and upserts one week's full rosVorShapeSnapshots board for
// every league shape any season currently has (see lib/leagueShape.ts) -
// called from convex/fetchAllData.ts's daily refreshCachedComputations.
// Upserted by (shapeId, week, fpid): a same-week rerun (the cron runs
// daily, this is meant to read as weekly) just refreshes that week's
// numbers in place, and a new row per player only appears once the NFL
// week actually advances - same trick convex/infinileague/season/
// powerRankings.ts's snapshot upsert uses, just at per-player instead of
// per-team granularity, and this table (unlike that one) never prunes old
// weeks - the full history is the point (next season's draft prep wants
// every week's board, not just the latest).
//
// Split in two so the expensive part runs once per scoring setup, not
// once per shape: computeRosVorInputs does every heavy read (projections,
// recent playerPoints, playerSeasonStats, injuries, rosProjTotalSets) and
// produces each player's shape-independent values, and refreshRosVor then
// only does the cheap per-shape part (replacement levels off the shape's
// roster settings, VOR, ranks, upsert). Every input to a player's values is
// scoped to that player's own position (injury boosts only match same-
// position teammates), so computing over the union of a group's positions
// gives each shape exactly what it would have computed alone. Leagues
// sharing a shape share the one board, so N identical leagues cost one
// refreshRosVor, not N.
//
// `scheduled` marks a daily-cron run. On a deployment with the
// ROS_VOR_WEEKLY_ONLY env var set to "true" (dev - this refresh is one of
// the biggest DB I/O costs there, and dev doesn't need daily numbers), a
// scheduled run only does real work on Thursday's run (the cron fires at
// 12:00 UTC, so Wed night/Thu morning US time) - or for any season whose
// shape has no board for the current week yet, so a rollover never leaves the
// Players/Trade tabs empty until Thursday. Manual runs (fetchAll/
// refreshCaches) always refresh.
const WEEKLY_REFRESH_UTC_DAY = 4; // Thursday
export async function refreshAllRosVor(
  ctx: ActionCtx,
  args: { seasons: Doc<"seasons">[]; scheduled?: boolean | undefined },
): Promise<void> {
  // Same "not currently in an NFL regular season week" guard as
  // convex/lib/faab.ts's computeFaabSuggestions - rosVor is an in-season
  // concept (needs actual playerPoints history, injury freshness tied to
  // a real week), unlike draftValues, which stays meaningful year-round.
  const week = await ctx.runQuery(internal.rosVor.getRosVorWeek, {});
  if (week === null) return;

  const throttled =
    args.scheduled === true && process.env.ROS_VOR_WEEKLY_ONLY === "true" && new Date().getUTCDay() !== WEEKLY_REFRESH_UTC_DAY;

  const groups = new Map<string, { scoringConfig: ScoringConfig; positions: Set<Position>; shapes: Map<string, LeagueShapeFields> }>();
  for (const season of args.seasons) {
    const shape = leagueShapeOf(season);
    if (throttled && (await ctx.runQuery(internal.rosVor.hasRosVorBoard, { shapeKey: shape.key, week }))) continue;
    const scoringConfig = scoringConfigFromSeason(season);
    const key = `${scoringConfig.scoring}|${scoringConfig.teScoring}|${scoringConfig.sixPointPassTds}`;
    const group = groups.get(key) ?? { scoringConfig, positions: new Set<Position>(), shapes: new Map() };
    for (const pos of activePositionsFor(shape.fields)) group.positions.add(pos);
    group.shapes.set(shape.key, shape.fields);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    const players = await ctx.runQuery(internal.rosVor.computeRosVorInputs, {
      week,
      positions: POSITIONS.filter((pos) => group.positions.has(pos)),
      scoringConfig: group.scoringConfig,
    });
    for (const shape of group.shapes.values()) {
      await ctx.runMutation(internal.rosVor.refreshRosVor, { shape, week, players });
    }
  }
}

function activePositionsFor(settings: LeagueShapeFields): Position[] {
  return POSITIONS.filter(
    (pos) => settings.rosterSlots[pos] > 0 || settings.flexPositions.includes(pos) || settings.superflexPositions.includes(pos),
  );
}

// Builds one season's board for the current week right away if its shape
// doesn't have one yet (a league with settings no other league has, or one
// whose settings just changed), instead of leaving its Players/Trade/Free
// Agents tabs empty until the next daily cron. Scheduled from every
// provider roster sync (Sleeper/ESPN/Yahoo), which is infinileague's first
// touch on a new league, and from every settings change - a no-op once the
// board exists, so it costs a couple of indexed reads. Same path the cron
// uses, just for this one season's shape.
export const ensureSeasonRosVor = internalAction({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<void> => {
    const season = await ctx.runQuery(internal.rosVor.getSeasonMissingRosVor, { seasonId: args.seasonId });
    if (season === null) return;
    await refreshAllRosVor(ctx, { seasons: [season] });
  },
});

// For mutations that change a season's shape fields (teamCount, scoring,
// roster slots, flex eligibility) - the season now reads a different
// shape's board, which may not exist yet.
export async function scheduleEnsureSeasonRosVor(ctx: MutationCtx, seasonId: Id<"seasons">): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.rosVor.ensureSeasonRosVor, { seasonId });
}

// The season's doc when its shape has no board for the current week, else
// null (board already there, season gone, or not an NFL regular-season week).
export const getSeasonMissingRosVor = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<Doc<"seasons"> | null> => {
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState || nflState.seasonType !== "regular") return null;
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    return (await shapeHasBoard(ctx, leagueShapeOf(season).key, nflState.week)) ? null : season;
  },
});

async function shapeHasBoard(ctx: QueryCtx, shapeKey: string, week: string): Promise<boolean> {
  const shapeId = await findLeagueShapeId(ctx, shapeKey);
  if (!shapeId) return false;
  const row = await ctx.db
    .query("rosVorShapeSnapshots")
    .withIndex("by_shape_week_fpid", (q) => q.eq("shapeId", shapeId).eq("week", week))
    .first();
  return row !== null;
}

export const getRosVorWeek = internalQuery({
  args: {},
  handler: async (ctx): Promise<string | null> => {
    const nflState = await ctx.db.query("nflState").first();
    return nflState && nflState.seasonType === "regular" ? nflState.week : null;
  },
});

export const hasRosVorBoard = internalQuery({
  args: { shapeKey: v.string(), week: v.string() },
  handler: async (ctx, args): Promise<boolean> => shapeHasBoard(ctx, args.shapeKey, args.week),
});

// One player's league-independent values for one scoring setup - see
// refreshAllRosVor's comment above for the split.
const rosVorInputValidator = v.object({
  fpid: v.number(),
  name: v.string(),
  team: v.union(v.string(), v.null()),
  position: positionValidator,
  rosValue: v.number(),
  rosPpg: v.number(),
  weekValue: v.number(),
  weekPpg: v.number(),
  actualPoints: v.number(),
  actualPpg: v.number(),
  boostReason: v.union(v.string(), v.null()),
});
type RosVorInput = Infer<typeof rosVorInputValidator>;

export const computeRosVorInputs = internalQuery({
  args: { week: v.string(), positions: v.array(positionValidator), scoringConfig: scoringConfigValidator },
  handler: async (ctx, args): Promise<RosVorInput[]> => {
    const { week, positions: activePositions, scoringConfig } = args;
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState) return [];
    const remainingWeeks = Math.max(18 - Number(week) + 1, 0);

    // No rosterPlayers read here (unlike convex/lib/faab.ts) - replacement
    // level is computed against the full player pool regardless of
    // rostered status (see refreshRosVor), and rosVor/rosRank/actualVor/
    // actualRank are stored for every player either way.
    const forms = await gatherPlayerForms(ctx, { activePositions, week, season: nflState.season, scoringConfig });

    // Real per-remaining-week projection sum (bye-aware - a bye week simply
    // has no projections row to add), rebuilt daily across every scoring
    // combo by convex/rosProjTotals.ts - see that file for why this is a
    // separate shared cache rather than summed here on every refresh. Falls
    // back to the old flat single-week extrapolation on a cache miss (this
    // combo's daily refresh hasn't run yet), same cache-miss fallback
    // convex/valueGaps.ts's getAllValueGaps uses.
    const rosProjTotals = await gatherRosProjTotals(ctx, { activePositions, scoringConfig });

    // Applied to EVERY player (rostered or not), unlike FAAB's own
    // valueOf, which only boosts the free-agent view - a general "how good
    // is this player right now" ranking should reflect a role bump
    // whether or not anyone happens to already roster them.
    const boosts = await findInjuryBoosts(ctx, { forms });

    // gamesPlayed rides along for actualPpg, not used by the replacement-
    // level math itself.
    const actualStatsByFpid = new Map<number, { totalPoints: number; gamesPlayed: number }>();
    for (const pos of activePositions) {
      const rows = await ctx.db
        .query("playerSeasonStats")
        .withIndex("by_position_season_scoring_teScoring_sixPointPassTds", (q) =>
          q
            .eq("position", pos)
            .eq("season", nflState.season)
            .eq("scoring", scoringConfig.scoring)
            .eq("teScoring", scoringConfig.teScoring)
            .eq("sixPointPassTds", scoringConfig.sixPointPassTds),
        )
        .collect();
      for (const row of rows) actualStatsByFpid.set(row.fpid, { totalPoints: row.totalPoints, gamesPlayed: row.gamesPlayed });
    }

    return [...forms.values()].map((form) => {
      const cached = rosProjTotals.get(form.fpid);
      const totalRawProjection = cached ? cached.totalPoints : form.currentWeekProjection * remainingWeeks;
      // Divides by this player's own weeksIncluded (which excludes any bye
      // still ahead of them), not the season-wide remainingWeeks - two
      // players with the same rosValue but different bye timing should
      // still show the same per-game rate.
      const rosWeeks = cached ? cached.weeksIncluded : remainingWeeks;
      const boost = boosts.get(form.fpid);
      let rosValue = totalRawProjection * momentumMultiplier(form);
      if (boost) {
        const boostedWeeks = Math.min(boost.boostedWeeks, remainingWeeks);
        rosValue += Math.max(boost.boostedRate - forwardRate(form), 0) * boostedWeeks;
      }

      // Single-week value - same momentum-adjusted rate rosValue is built
      // from, but for just the current week (no remainingWeeks multiplier),
      // with an injury boost applied for one week only rather than the full
      // boostedWeeks span.
      let weekValue = forwardRate(form);
      if (boost && remainingWeeks > 0) {
        weekValue += Math.max(boost.boostedRate - forwardRate(form), 0);
      }

      const actualStats = actualStatsByFpid.get(form.fpid);
      return {
        fpid: form.fpid,
        name: form.name,
        team: form.team,
        position: form.position,
        rosValue,
        rosPpg: rosWeeks > 0 ? rosValue / rosWeeks : 0,
        weekValue,
        // The plain, un-momentum-adjusted projection - see PlayerForm.
        // currentWeekProjectionRaw's comment for why this (not weekValue)
        // is what gets displayed.
        weekPpg: form.currentWeekProjectionRaw,
        actualPoints: actualStats?.totalPoints ?? 0,
        actualPpg: actualStats && actualStats.gamesPlayed > 0 ? actualStats.totalPoints / actualStats.gamesPlayed : 0,
        boostReason: boost?.reason ?? null,
      };
    });
  },
});

// Per-shape half of the refresh - see refreshAllRosVor's comment above.
export const refreshRosVor = internalMutation({
  args: { shape: leagueShapeFieldsValidator, week: v.string(), players: v.array(rosVorInputValidator) },
  handler: async (ctx, args) => {
    const settings = args.shape;
    const shapeId = await ensureLeagueShapeId(ctx, settings);

    const activePositions = activePositionsFor(settings);
    const active = new Set<Position>(activePositions);
    const players = args.players.filter((player) => active.has(player.position));

    // Replacement level - the FULL pool (rostered + free agent), ranked by
    // whichever value is being measured (computeReplacementLevels only
    // cares that its input is sorted by "rosValue" descending, not what
    // that number represents), same as the pre-draft engine's own pool
    // (convex/draftValues.ts). computeReplacementLevels' demand-offset math
    // (teamCount * rosterSlots[pos]) assumes it's indexing into an
    // undivided pool - feeding it the free-agent-only pool would double-
    // count demand already satisfied by the rostered players excluded from
    // it, pushing "replacement level" absurdly deep (confirmed live: every
    // QB in a 2-QB league showed replacement=0, since the offset landed
    // past the end of the free-agent list entirely). Computed separately
    // for forward (rosValue), single-week (weekValue - the "next player
    // up" this week isn't necessarily the same player it is for the rest
    // of the season), and backward (actual points scored this season).
    const replacementLevels = (valueOf: (player: RosVorInput) => number) => {
      const byPosition = new Map<Position, ValuedPlayer[]>();
      for (const pos of activePositions) {
        const rows = players
          .filter((player) => player.position === pos)
          .map((player) => ({ fpid: player.fpid, name: player.name, team: player.team, position: player.position, rosValue: valueOf(player) }))
          .sort((a, b) => b.rosValue - a.rosValue);
        byPosition.set(pos, rows);
      }
      return computeReplacementLevels(settings, activePositions, byPosition);
    };
    const rosReplacementValues = replacementLevels((player) => player.rosValue);
    const weekReplacementValues = replacementLevels((player) => player.weekValue);
    const actualReplacementValues = replacementLevels((player) => player.actualPoints);

    // Global (not per-position) rank for both metrics - a real "overall"
    // fantasy board mixes positions, ranked purely by how far above
    // replacement each player is, which is exactly what VOR puts on a
    // comparable cross-position scale.
    const valued = players.map((player) => ({
      player,
      rosVor: player.rosValue - rosReplacementValues[player.position],
      actualVor: player.actualPoints - actualReplacementValues[player.position],
      weekVor: player.weekValue - weekReplacementValues[player.position],
    }));
    const rankBy = (valueOf: (row: (typeof valued)[number]) => number) => {
      const ranks = new Map<number, number>();
      [...valued]
        .sort((a, b) => valueOf(b) - valueOf(a))
        .forEach((row, index) => ranks.set(row.player.fpid, index + 1));
      return ranks;
    };
    const rosRankByFpid = rankBy((row) => row.rosVor);
    const actualRankByFpid = rankBy((row) => row.actualVor);
    const weekRankByFpid = rankBy((row) => row.weekVor);

    const existing = await ctx.db
      .query("rosVorShapeSnapshots")
      .withIndex("by_shape_week_fpid", (q) => q.eq("shapeId", shapeId).eq("week", args.week))
      .collect();
    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const now = Date.now();
    const seen = new Set<number>();

    // Only write rows whose values actually changed - most of the board is
    // identical day to day (deep bench players, anyone whose projection
    // didn't move), and unconditionally patching every row (computedAt
    // alone always differed) was rewriting the whole table every run.
    // Floats are rounded so sub-display noise doesn't count as a change;
    // computedAt therefore means "last time this row's values changed."
    for (const { player, rosVor, actualVor, weekVor } of valued) {
      seen.add(player.fpid);
      const fields = {
        position: player.position,
        name: player.name,
        team: player.team,
        rosValue: round2(player.rosValue),
        rosPpg: round2(player.rosPpg),
        actualPpg: round2(player.actualPpg),
        boostReason: player.boostReason,
        rosVor: round2(rosVor),
        rosRank: rosRankByFpid.get(player.fpid) ?? 0,
        actualVor: round2(actualVor),
        actualRank: actualRankByFpid.get(player.fpid) ?? 0,
        weekVor: round2(weekVor),
        weekRank: weekRankByFpid.get(player.fpid) ?? 0,
        weekPpg: round2(player.weekPpg),
      };
      const match = existingByFpid.get(player.fpid);
      if (match) {
        const changed = (Object.keys(fields) as (keyof typeof fields)[]).some((key) => match[key] !== fields[key]);
        if (changed) await ctx.db.patch(match._id, { ...fields, computedAt: now });
      } else {
        await ctx.db.insert("rosVorShapeSnapshots", {
          shapeId,
          week: args.week,
          fpid: player.fpid,
          ...fields,
          computedAt: now,
        });
      }
    }

    // Drop players who no longer have a current-week projection (e.g. long-
    // term IR) - mirrors upsertProjections' own prune-on-refresh pattern.
    for (const row of existing) {
      if (!seen.has(row.fpid)) {
        await ctx.db.delete(row._id);
      }
    }
  },
});

// One season's full board for a given week, ranked best-first - the UI-
// facing rank fields (rosRank/actualRank), not the raw VOR values, are
// what should actually be shown (see schema.ts's comment). Includes every
// rosterable player (rostered or free agent) - rosteredByTeamName is the
// fantasy team's own name (not the NFL team abbreviation already on
// `team`), null for a free agent, powering infinileague's Players tab.
export const getRosVorBoard = query({
  args: {
    seasonId: v.id("seasons"),
    week: v.string(),
    position: v.optional(positionValidator),
    // Whoever's asking "which of these are mine" - the Players tab passes
    // the viewer's own teamId; other callers (Trade/Depth Charts/Free
    // Agents tabs) that don't need per-row ownership just omit it, and
    // every row's isOnMyTeam comes back false rather than comparing against
    // nothing.
    teamId: v.optional(v.id("seasonTeams")),
  },
  handler: async (ctx, args): Promise<RosVorRow[]> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);

    const [rows, rosteredRows, teams, injuries] = await Promise.all([
      loadSeasonRosVorRows(ctx, season, args.week),
      ctx.db
        .query("rosterPlayers")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
      ctx.db
        .query("seasonTeams")
        .withIndex("by_season", (q) => q.eq("seasonId", args.seasonId))
        .collect(),
      ctx.db.query("injuries").collect(),
    ]);
    const teamNameById = new Map(teams.map((team) => [team._id, team.name]));
    const teamNameByFpid = new Map(rosteredRows.map((row) => [row.fpid, teamNameById.get(row.teamId) ?? null]));
    const teamIdByFpid = new Map(rosteredRows.map((row) => [row.fpid, row.teamId]));
    const injuryByFpid = new Map(injuries.map((row) => [row.fpid, row]));

    // Positional rank - grouped from this week's full board (before the
    // optional position filter below), same rosVor ordering rosRank uses
    // globally, just scoped to one position at a time.
    const byPosition = new Map<Position, typeof rows>();
    for (const row of rows) {
      const list = byPosition.get(row.position) ?? [];
      list.push(row);
      byPosition.set(row.position, list);
    }
    const positionRankByFpid = new Map<number, number>();
    for (const list of byPosition.values()) {
      [...list]
        .sort((a, b) => b.rosVor - a.rosVor)
        .forEach((row, index) => positionRankByFpid.set(row.fpid, index + 1));
    }
    // Week-mode counterpart, sorted by weekVor instead - powers the
    // Players tab's position-rank badge when its toggle is set to "This
    // Week" (see infinileague/src/routes/league/$leagueId/players.tsx).
    const weekPositionRankByFpid = new Map<number, number>();
    for (const list of byPosition.values()) {
      [...list]
        .sort((a, b) => (b.weekVor ?? 0) - (a.weekVor ?? 0))
        .forEach((row, index) => weekPositionRankByFpid.set(row.fpid, index + 1));
    }

    return rows
      .filter((row) => !args.position || row.position === args.position)
      .sort((a, b) => a.rosRank - b.rosRank)
      .map((row) => {
        const injury = injuryByFpid.get(row.fpid);
        return {
          fpid: row.fpid,
          name: row.name,
          team: row.team,
          position: row.position,
          rosVor: row.rosVor,
          rosRank: row.rosRank,
          actualVor: row.actualVor,
          actualRank: row.actualRank,
          positionRank: positionRankByFpid.get(row.fpid) ?? 0,
          rosPpg: row.rosPpg ?? 0,
          actualPpg: row.actualPpg ?? 0,
          weekVor: row.weekVor ?? 0,
          weekRank: row.weekRank ?? 0,
          weekPpg: row.weekPpg ?? 0,
          weekPositionRank: weekPositionRankByFpid.get(row.fpid) ?? 0,
          rosteredByTeamName: teamNameByFpid.get(row.fpid) ?? null,
          isOnMyTeam: args.teamId !== undefined && teamIdByFpid.get(row.fpid) === args.teamId,
          ...(injury ? { injury: { status: injury.status, statusShort: injury.statusShort } } : {}),
        };
      });
  },
});

// Actual fantasy points for one week, in this season's scoring (base
// format + TE premium / 6pt passing TD bonus) - powers the Players tab's
// This Week view. Separate from getRosVorBoard on purpose: the live
// document below changes every few minutes during games, and only the
// Players tab wants that - folding it into the board would re-run the
// whole board for every tab that uses it (Trade, Free Agents, Depth
// Charts) on each update. A player with no entry hasn't played yet.
export const getWeekPoints = query({
  args: { seasonId: v.id("seasons"), week: v.string() },
  handler: async (ctx, args): Promise<Array<{ fpid: number; points: number }>> => {
    await requireSeasonOwner(ctx, args.seasonId);
    const entries = await loadWeekPoints(ctx, args.seasonId, args.week);
    return entries.map((entry) => ({ fpid: entry.fpid, points: entry.points }));
  },
});

// One player's full weekly history for a season, oldest first - "rank vs.
// last week" is just comparing consecutive entries; the full run is what
// next season's draft prep wants (see this file's header comment).
export const getPlayerRosVorHistory = query({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args) => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);

    // The season's current shape for every week - see lib/leagueShape.ts's
    // loadSeasonRosVorRows on why past weeks don't follow a settings change.
    const shapeId = await findLeagueShapeId(ctx, leagueShapeOf(season).key);
    if (!shapeId) return [];
    const rows = await ctx.db
      .query("rosVorShapeSnapshots")
      .withIndex("by_shape_fpid", (q) => q.eq("shapeId", shapeId).eq("fpid", args.fpid))
      .collect();
    return rows.sort((a, b) => Number(a.week) - Number(b.week));
  },
});

// One-off migration from the LEGACY per-season rosVorSnapshots table to the
// per-shape rosVorShapeSnapshots one (see schema.ts) - run once per
// deployment after this ships (`npx convex run rosVor:backfillRosVorShapeSnapshots`),
// reschedules itself until the whole table has been walked. Each row goes
// to its season's CURRENT shape; leagues that share a shape hold identical
// rows for a week, so the first one copied wins and the rest are skipped.
// Rows for deleted seasons are dropped. Safe to rerun (only ever inserts
// rows that are missing), and safe alongside the daily refresh.
export const backfillRosVorShapeSnapshots = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("rosVorSnapshots").paginate({ cursor: args.cursor ?? null, numItems: 200 });

    const shapeIdBySeason = new Map<Id<"seasons">, Id<"leagueShapes"> | null>();
    for (const row of result.page) {
      if (!shapeIdBySeason.has(row.seasonId)) {
        const season = await ctx.db.get(row.seasonId);
        shapeIdBySeason.set(row.seasonId, season ? await ensureLeagueShapeId(ctx, leagueShapeOf(season).fields) : null);
      }
      const shapeId = shapeIdBySeason.get(row.seasonId);
      if (!shapeId) continue;

      const existing = await ctx.db
        .query("rosVorShapeSnapshots")
        .withIndex("by_shape_week_fpid", (q) => q.eq("shapeId", shapeId).eq("week", row.week).eq("fpid", row.fpid))
        .first();
      if (existing) continue;
      await ctx.db.insert("rosVorShapeSnapshots", {
        shapeId,
        week: row.week,
        fpid: row.fpid,
        position: row.position,
        name: row.name,
        team: row.team,
        rosVor: row.rosVor,
        rosRank: row.rosRank,
        ...(row.rosValue !== undefined ? { rosValue: row.rosValue } : {}),
        boostReason: row.boostReason,
        actualVor: row.actualVor,
        actualRank: row.actualRank,
        ...(row.rosPpg !== undefined ? { rosPpg: row.rosPpg } : {}),
        ...(row.actualPpg !== undefined ? { actualPpg: row.actualPpg } : {}),
        ...(row.weekVor !== undefined ? { weekVor: row.weekVor } : {}),
        ...(row.weekRank !== undefined ? { weekRank: row.weekRank } : {}),
        ...(row.weekPpg !== undefined ? { weekPpg: row.weekPpg } : {}),
        computedAt: row.computedAt,
      });
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.rosVor.backfillRosVorShapeSnapshots, { cursor: result.continueCursor });
    }
  },
});

// One-off cleanup for the LEGACY rosVorSnapshots table, same pattern as
// valueGaps.ts's clearValueGaps - run only after the backfill above has
// finished, then that table's definition can be removed.
export const clearLegacyRosVorSnapshots = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("rosVorSnapshots").paginate({ cursor: args.cursor ?? null, numItems: 500 });
    for (const row of result.page) {
      await ctx.db.delete(row._id);
    }
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.rosVor.clearLegacyRosVorSnapshots, { cursor: result.continueCursor });
    }
  },
});
