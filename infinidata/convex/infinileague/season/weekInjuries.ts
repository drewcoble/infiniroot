import { v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import { normalizeNflTeam } from "../../lib/liveGames";

type WeekInjury = { fpid: number; status: string; statusShort: string };

// Each player's injury designation for one week of the current season -
// what getTeamRosterForWeek attaches to its rows, so the Matchup tab shows
// the designation that applied to the week being viewed rather than
// today's:
// - A week whose game has kicked off (past weeks, or the current week once
//   that player's team has played): the status as of kickoff, from the
//   injurySnapshots change log - the latest row recorded at or before
//   kickoff ("cleared" = healthy). A team on bye uses the week's last
//   kickoff instead. Snapshots only exist from when that table was
//   introduced, so an injury that predates it and never changed reads as
//   healthy for those early weeks.
// - The current week before that player's game: the live injuries table.
// - Future weeks: only IR carries forward - a Questionable/Out tag
//   describes this week's game, not next month's.
// `team` is each player's NFL team (Sleeper codes, as on players.team).
export const getInjuriesForWeek = internalQuery({
  args: {
    week: v.string(),
    players: v.array(v.object({ fpid: v.number(), team: v.union(v.string(), v.null()) })),
  },
  handler: async (ctx, args): Promise<WeekInjury[]> => {
    const nflState = await ctx.db.query("nflState").first();
    if (!nflState) return [];
    const viewedWeek = Number(args.week);
    const currentWeek = Number(nflState.week);

    const currentInjuryFor = async (fpid: number) =>
      await ctx.db
        .query("injuries")
        .withIndex("by_fpid", (q) => q.eq("fpid", fpid))
        .first();

    if (viewedWeek > currentWeek) {
      const rows = await Promise.all(args.players.map((player) => currentInjuryFor(player.fpid)));
      return rows.flatMap((row) =>
        row && row.statusShort === "IR"
          ? [{ fpid: row.fpid, status: row.status, statusShort: row.statusShort }]
          : [],
      );
    }

    const games = await ctx.db
      .query("nflGames")
      .withIndex("by_season_week", (q) => q.eq("season", nflState.season).eq("week", args.week))
      .collect();
    const kickoffByTeam = new Map<string, number>();
    for (const game of games) {
      kickoffByTeam.set(normalizeNflTeam(game.homeTeam), game.kickoffAt);
      kickoffByTeam.set(normalizeNflTeam(game.awayTeam), game.kickoffAt);
    }
    const lastKickoff = games.length > 0 ? Math.max(...games.map((game) => game.kickoffAt)) : undefined;
    const now = Date.now();

    const results = await Promise.all(
      args.players.map(async (player): Promise<WeekInjury | null> => {
        const cutoff = (player.team ? kickoffByTeam.get(player.team) : undefined) ?? lastKickoff;
        if (viewedWeek === currentWeek && (cutoff === undefined || cutoff > now)) {
          const row = await currentInjuryFor(player.fpid);
          return row ? { fpid: row.fpid, status: row.status, statusShort: row.statusShort } : null;
        }
        if (cutoff === undefined) return null;

        const snapshots = await ctx.db
          .query("injurySnapshots")
          .withIndex("by_fpid_season", (q) =>
            q.eq("fpid", player.fpid).eq("season", nflState.season),
          )
          .collect();
        const atKickoff = snapshots
          .filter((row) => row.fetchedAt <= cutoff)
          .reduce<(typeof snapshots)[number] | null>(
            (latest, row) => (latest === null || row.fetchedAt > latest.fetchedAt ? row : latest),
            null,
          );
        if (!atKickoff || atKickoff.kind === "cleared" || !atKickoff.statusShort) return null;
        return { fpid: player.fpid, status: atKickoff.status, statusShort: atKickoff.statusShort };
      }),
    );
    return results.filter((row): row is WeekInjury => row !== null);
  },
});
