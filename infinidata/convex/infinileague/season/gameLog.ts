import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Doc } from "../../_generated/dataModel";
import { requireSeasonOwner } from "../../lib/access";
import { normalizeNflTeam } from "../../lib/liveGames";
import { BYE_WEEKS_2026 } from "../../nflSchedule";
import type { POSITIONS } from "../../positions";
import { bonusPoints, pointsForScoring, scoringConfigFromSeason } from "../../scoring";

type Position = (typeof POSITIONS)[number];
type Stats = Record<string, number>;

// One game-log column - `group` is the header spanning a run of columns
// (Passing, Rushing, ...), `label` the column's own short header.
interface ColumnDef {
  key: string;
  group: string;
  label: string;
  // Decimal places to show (0 for counts).
  decimals: number;
  value: (stats: Stats) => number;
}

function stat(key: string): (stats: Stats) => number {
  return (stats) => stats[key] ?? 0;
}
function col(group: string, label: string, key: string, decimals = 0): ColumnDef {
  return { key, group, label, decimals, value: stat(key) };
}

const SNAP_PCT: ColumnDef = {
  key: "snap_pct",
  group: "Snaps",
  label: "Snap %",
  decimals: 0,
  value: (stats) => (stats.tm_off_snp ? ((stats.off_snp ?? 0) / stats.tm_off_snp) * 100 : 0),
};
const PASSING = [
  col("Passing", "Att", "pass_att"),
  col("Passing", "Cmp%", "cmp_pct", 1),
  col("Passing", "Yds", "pass_yd"),
  col("Passing", "Air", "pass_air_yd"),
  col("Passing", "TD", "pass_td"),
  col("Passing", "Int", "pass_int"),
  col("Passing", "2PT", "pass_2pt"),
  col("Passing", "RZ Att", "pass_rz_att"),
];
const RUSHING = [
  col("Rushing", "Att", "rush_att"),
  col("Rushing", "Yds", "rush_yd"),
  col("Rushing", "Avg", "rush_ypa", 1),
  col("Rushing", "TD", "rush_td"),
  col("Rushing", "2PT", "rush_2pt"),
  col("Rushing", "RZ Att", "rush_rz_att"),
];
const RECEIVING = [
  col("Receiving", "Tgt", "rec_tgt"),
  col("Receiving", "Rec", "rec"),
  col("Receiving", "Yds", "rec_yd"),
  col("Receiving", "Air", "rec_air_yd"),
  col("Receiving", "TD", "rec_td"),
  col("Receiving", "2PT", "rec_2pt"),
  col("Receiving", "RZ Tgt", "rec_rz_tgt"),
  col("Receiving", "Drop", "rec_drop"),
];
const FUMBLES = [col("Fumbles", "Fum", "fum"), col("Fumbles", "Lost", "fum_lost")];
const KICKING = [
  col("Field Goals", "FGA", "fga"),
  col("Field Goals", "FGM", "fgm"),
  col("Field Goals", "Miss", "fgmiss"),
  col("FG Made", "20-29", "fgm_20_29"),
  col("FG Made", "30-39", "fgm_30_39"),
  col("FG Made", "40-49", "fgm_40_49"),
  col("FG Made", "50-59", "fgm_50_59"),
  col("FG Made", "50+", "fgm_50p"),
  col("FG Made", "60+", "fgm_60p"),
  col("FG Missed", "40-49", "fgmiss_40_49"),
  col("FG Missed", "50-59", "fgmiss_50_59"),
  col("FG Missed", "50+", "fgmiss_50p"),
  col("FG Missed", "60+", "fgmiss_60p"),
  col("Extra Points", "XPA", "xpa"),
  col("Extra Points", "XPM", "xpm"),
  col("Extra Points", "Miss", "xpmiss"),
];
// Special-teams forced fumbles/recoveries/return TDs are their own Sleeper
// keys (not included in ff/fum_rec/def_td) - folded in here, the way
// fantasy scoring counts them.
const DEFENSE: ColumnDef[] = [
  col("Defense", "Sack", "sack"),
  col("Defense", "Int", "int"),
  { key: "ff", group: "Defense", label: "FF", decimals: 0, value: (s) => (s.ff ?? 0) + (s.def_st_ff ?? 0) },
  { key: "fum_rec", group: "Defense", label: "FR", decimals: 0, value: (s) => (s.fum_rec ?? 0) + (s.def_st_fum_rec ?? 0) },
  { key: "def_td", group: "Defense", label: "TD", decimals: 0, value: (s) => (s.def_td ?? 0) + (s.def_st_td ?? 0) },
  col("Defense", "QB Hit", "qb_hit"),
  col("Blocks", "Kick", "blk_kick"),
  col("Blocks", "FG", "fg_blkd"),
  col("Blocks", "Ret Yds", "blk_kick_ret_yd"),
  col("Allowed", "Pts", "pts_allow"),
  col("Allowed", "Yds", "yds_allow"),
  col("Stops", "3 & Out", "def_3_and_out"),
  col("Stops", "4th Down", "def_4_and_stop"),
  // Copied from a teammate's record at sync time - see
  // sleeper/playerPoints.ts's parseSleeperStatsRecords.
  col("Snaps", "On Field", "tm_def_snp"),
  col("Snaps", "Off Field", "tm_off_snp"),
];

// Column groups per position - `optional` groups only appear when the
// player has a non-zero value in them that season (a QB's catch, an RB's
// pass, a WR's carries), so most logs stay narrow.
const LAYOUT: Record<Position, Array<{ columns: ColumnDef[]; optional?: boolean }>> = {
  QB: [{ columns: [SNAP_PCT] }, { columns: PASSING }, { columns: RUSHING }, { columns: RECEIVING, optional: true }, { columns: FUMBLES }],
  RB: [{ columns: [SNAP_PCT] }, { columns: RUSHING }, { columns: RECEIVING }, { columns: PASSING, optional: true }, { columns: FUMBLES }],
  WR: [{ columns: [SNAP_PCT] }, { columns: RECEIVING }, { columns: RUSHING, optional: true }, { columns: PASSING, optional: true }, { columns: FUMBLES }],
  TE: [{ columns: [SNAP_PCT] }, { columns: RECEIVING }, { columns: RUSHING, optional: true }, { columns: PASSING, optional: true }, { columns: FUMBLES }],
  K: [{ columns: KICKING }],
  DST: [{ columns: DEFENSE }],
};

export interface GameLogWeek {
  week: number;
  // "played": a real game with stats. "dnp": the team played, he didn't
  // (every value null - shown as dashes). "bye": no team game that week.
  kind: "played" | "dnp" | "bye";
  injury: { status: string; statusShort: string } | null;
  points: number | null;
  positionRank: number | null;
  values: Array<number | null>;
}

// Which seasons this player has a game log for, newest first, with the
// season-long total in this league's scoring for each collapsed year
// header. The current NFL season is always included (even before his
// first game) so the log has somewhere to start.
export const getGameLogSeasons = query({
  args: { seasonId: v.id("seasons"), fpid: v.number() },
  handler: async (ctx, args): Promise<Array<{ season: string; gamesPlayed: number; totalPoints: number }>> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const config = scoringConfigFromSeason(season);
    const [rows, nflState] = await Promise.all([
      ctx.db
        .query("playerSeasonStats")
        .withIndex("by_fpid_season_scoring_teScoring_sixPointPassTds", (q) => q.eq("fpid", args.fpid))
        .collect(),
      ctx.db.query("nflState").first(),
    ]);
    const bySeason = new Map<string, { season: string; gamesPlayed: number; totalPoints: number }>();
    for (const row of rows) {
      if (row.scoring !== config.scoring || row.teScoring !== config.teScoring || row.sixPointPassTds !== config.sixPointPassTds) continue;
      bySeason.set(row.season, { season: row.season, gamesPlayed: row.gamesPlayed, totalPoints: row.totalPoints });
    }
    if (nflState && !bySeason.has(nflState.season)) {
      bySeason.set(nflState.season, { season: nflState.season, gamesPlayed: 0, totalPoints: 0 });
    }
    return [...bySeason.values()].sort((a, b) => Number(b.season) - Number(a.season));
  },
});

// One player's week-by-week log for one NFL season, in this league's
// scoring - every week through the last one played (all 18 for a past
// season), with byes and missed games as their own rows. Fetched only when
// that year is expanded.
export const getGameLog = query({
  args: { seasonId: v.id("seasons"), fpid: v.number(), year: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ columns: Array<{ key: string; group: string; label: string; decimals: number }>; weeks: GameLogWeek[] } | null> => {
    const { season } = await requireSeasonOwner(ctx, args.seasonId);
    const config = scoringConfigFromSeason(season);

    const [player, nflState] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_fpid", (q) => q.eq("fpid", args.fpid))
        .first(),
      ctx.db.query("nflState").first(),
    ]);
    if (!player) return null;
    const position = player.position;

    const [pointRows, rankSets, games, snapshots] = await Promise.all([
      ctx.db
        .query("playerWeekPoints")
        .withIndex("by_fpid_season", (q) => q.eq("fpid", args.fpid).eq("season", args.year))
        .collect(),
      ctx.db
        .query("weekPositionRankSets")
        .withIndex("by_key", (q) =>
          q
            .eq("season", args.year)
            .eq("position", position)
            .eq("scoring", config.scoring)
            .eq("teScoring", config.teScoring)
            .eq("sixPointPassTds", config.sixPointPassTds),
        )
        .collect(),
      ctx.db
        .query("nflGames")
        .withIndex("by_season_week", (q) => q.eq("season", args.year))
        .collect(),
      ctx.db
        .query("injurySnapshots")
        .withIndex("by_fpid_season", (q) => q.eq("fpid", args.fpid).eq("season", args.year))
        .collect(),
    ]);

    const rowByWeek = new Map<number, Doc<"playerWeekPoints">>(pointRows.map((row) => [Number(row.week), row]));
    const rankByWeek = new Map<number, number>();
    for (const set of rankSets) {
      const entry = set.ranks.find((rank) => rank.fpid === args.fpid);
      if (entry) rankByWeek.set(Number(set.week), entry.rank);
    }
    // Per week: this player's team's kickoff (absent = bye), and the
    // week's last kickoff (the cutoff for a bye week's injury status).
    const team = player.team;
    const kickoffByWeek = new Map<number, number>();
    const scheduledWeeks = new Set<number>();
    for (const game of games) {
      const week = Number(game.week);
      scheduledWeeks.add(week);
      if (team && (normalizeNflTeam(game.homeTeam) === team || normalizeNflTeam(game.awayTeam) === team)) {
        kickoffByWeek.set(week, game.kickoffAt);
      }
    }

    // Every week up to the last one with a game played, or all 18 once
    // that season is over - never a future week.
    const isCurrentSeason = nflState?.season === args.year && nflState.seasonType === "regular";
    const latestWithData = Math.max(0, ...rowByWeek.keys());
    const lastWeek = isCurrentSeason ? Math.max(Number(nflState.week) - 1, latestWithData) : 18;

    const isBye = (week: number): boolean => {
      if (rowByWeek.has(week)) return false;
      if (!team) return false;
      if (scheduledWeeks.has(week)) return !kickoffByWeek.has(week);
      return args.year === "2026" && BYE_WEEKS_2026[team] === week;
    };

    // Status as of that week's kickoff - the latest injurySnapshots change
    // at or before it ("cleared" = healthy). Same rule weekInjuries.ts uses
    // for the Matchup tab. Snapshots only exist from 2026 on.
    const injuryAt = (cutoff: number | undefined): GameLogWeek["injury"] => {
      if (cutoff === undefined) return null;
      let latest: (typeof snapshots)[number] | null = null;
      for (const snap of snapshots) {
        if (snap.fetchedAt <= cutoff && (latest === null || snap.fetchedAt > latest.fetchedAt)) latest = snap;
      }
      if (!latest || latest.kind === "cleared" || !latest.statusShort) return null;
      return { status: latest.status, statusShort: latest.statusShort };
    };

    const playedStats = [...rowByWeek.values()].filter((row) => (row.stats.gp ?? 0) > 0).map((row) => row.stats);
    const columns = LAYOUT[position]
      .filter((group) => !group.optional || group.columns.some((column) => playedStats.some((stats) => column.value(stats) !== 0)))
      .flatMap((group) => group.columns);

    const weeks: GameLogWeek[] = [];
    for (let week = 1; week <= lastWeek; week += 1) {
      if (isBye(week)) {
        weeks.push({ week, kind: "bye", injury: null, points: null, positionRank: null, values: columns.map(() => null) });
        continue;
      }
      const row = rowByWeek.get(week);
      const injury = injuryAt(kickoffByWeek.get(week));
      if (!row || (row.stats.gp ?? 0) <= 0) {
        weeks.push({ week, kind: "dnp", injury, points: null, positionRank: null, values: columns.map(() => null) });
        continue;
      }
      weeks.push({
        week,
        kind: "played",
        injury,
        points: pointsForScoring(row, config.scoring) + bonusPoints({ position, stats: row.stats }, config),
        positionRank: rankByWeek.get(week) ?? null,
        values: columns.map((column) => column.value(row.stats)),
      });
    }

    return {
      columns: columns.map(({ key, group, label, decimals }) => ({ key, group, label, decimals })),
      weeks,
    };
  },
});
