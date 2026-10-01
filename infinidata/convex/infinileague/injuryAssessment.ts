import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { askJev, type JevQuestion, type JevResponse } from "../jev/client";
import { BYE_WEEKS_2026 } from "../nflSchedule";

// Sleeper designations that mean the player cannot play next game. These are
// roster/availability facts, not semantic judgments, so assessInjury sets
// plays_next_game to 0 for them in code instead of trusting the model.
const CANNOT_PLAY_STATUSES = new Set(["IR", "Out", "PUP", "Suspended", "Non-Football Injury"]);

// POC: asks Jev for semantic judgments about one injury, on demand from the
// Injuries page (nothing cached/stored yet, so every expand is a live call -
// easier to iterate on the questions below). Deliberately only questions Jev
// is good at - reading status/practice/comment text - and no numeric math
// (see Jev's jaggedness notes: it isn't a calculator).
const QUESTIONS: Record<string, JevQuestion> = {
  availability: {
    type: "score",
    instructions:
      "How likely is `player` to play in their team's next game, based on `injury`?",
    criteria: [
      "Will not play",
      "Unlikely to play",
      "Game-time decision",
      "Likely to play, possibly limited",
      "Will play with no limitation",
    ],
  },
  // Direct probability of playing, so any "prob. of playing" figure comes
  // straight from Jev instead of weights we'd invent over `availability`.
  plays_next_game: {
    type: "noul",
    instructions:
      "Will `player` play in their team's next game, based on `injury`? Use `history` (how they have fared in prior weeks while listed with this injury, including games already played through it) and `schedule` (if this week's game is already played or it is a bye, 'next game' is the following week's).",
  },
  // Conditional on playing, so it's separate from availability (whether they
  // play). Ordered levels, not a percentage, so any projection multiplier
  // stays our own math. (No start/sit/drop question: Jev lacks player value
  // and roster context, so its answers just restated the Sleeper status -
  // derive any action in code from these answers instead.)
  limitation: {
    type: "score",
    instructions:
      "Assume `player` does play in their team's next game. How much is `injury` likely to reduce their fantasy production compared to a fully healthy week (snaps, touches/targets, effectiveness)?",
    criteria: [
      "Severely limited - decoy or heavily reduced role",
      "Noticeably limited - reduced snaps or touches",
      "Slightly limited",
      "No meaningful impact",
    ],
  },
  timeline: {
    type: "choice",
    instructions:
      "How much time is `player` likely to miss because of `injury`? Judge from the injury itself (body part, surgery, severity) and where `nfl.week` falls in the season, not from IR status alone - IR is a roster designation, not a timeline.",
    criteria: {
      none: "No games missed",
      this_week: "Misses at most the next game",
      few_weeks: "Misses roughly 2-4 weeks",
      extended: "Misses 5+ weeks but is expected back before the season ends",
      season: "Out for the rest of the season, including any fantasy playoffs",
    },
  },
  aggravation_risk: {
    type: "noul",
    instructions:
      "Is `injury` a type prone to lingering or re-aggravation (e.g. hamstring, groin, calf, high ankle sprain)?",
  },
};

export const getInjuryState = internalQuery({
  args: { injuryId: v.id("injuries") },
  handler: async (ctx, args) => {
    const injury = await ctx.db.get(args.injuryId);
    if (!injury) throw new Error("Injury not found.");
    const player = await ctx.db
      .query("players")
      .withIndex("by_fpid", (q) => q.eq("fpid", injury.fpid))
      .unique();
    const nflState = await ctx.db.query("nflState").first();

    // Facts we count in code, since Jev reads text well but isn't a calculator.
    const season = nflState?.season ?? null;
    const currentWeek = nflState ? Number(nflState.week) : 0;
    const team = player?.team ?? null;
    const byeWeek = team ? (BYE_WEEKS_2026[team] ?? null) : null;

    let schedule: unknown = null;
    let history: unknown = null;
    if (season && currentWeek > 0) {
      const games = await ctx.db
        .query("nflGames")
        .withIndex("by_season_week", (q) =>
          q.eq("season", season).eq("week", String(currentWeek)),
        )
        .collect();
      const game = team
        ? games.find((g) => g.homeTeam === team || g.awayTeam === team)
        : undefined;
      const now = Date.now();
      schedule = {
        week: currentWeek,
        thisWeek: byeWeek === currentWeek
          ? "bye"
          : !game
            ? "unknown"
            : game.estimatedEndAt < now
              ? "already played"
              : game.kickoffAt < now
                ? "in progress"
                : "not started",
        kickoff: game ? new Date(game.kickoffAt).toISOString() : null,
        byeWeek,
      };

      const snapshots = (
        await ctx.db
          .query("injurySnapshots")
          .withIndex("by_fpid_season", (q) =>
            q.eq("fpid", injury.fpid).eq("season", season),
          )
          .collect()
      ).sort((a, b) => a.fetchedAt - b.fetchedAt);
      const points = await ctx.db
        .query("playerPoints")
        .withIndex("by_fpid_season_scoring", (q) =>
          q.eq("fpid", injury.fpid).eq("season", season).eq("scoring", "PPR"),
        )
        .collect();
      const played = new Set(
        points.filter((row) => row.points !== 0).map((row) => Number(row.week)),
      );

      // Latest snapshot per week; weeks before the first snapshot are skipped
      // (we have no designation for them), and the current week is excluded
      // since its game may not have been played yet.
      const byWeek = new Map<number, (typeof snapshots)[number]>();
      for (const snap of snapshots) {
        const week = Number(snap.week);
        if (week >= 1 && week < currentWeek) byWeek.set(week, snap);
      }
      const weeks = [...byWeek.entries()]
        .sort(([a], [b]) => a - b)
        .map(([week, snap]) => ({
          week,
          designation: snap.status,
          injury: snap.injuryType || null,
          result: week === byeWeek ? "bye" : played.has(week) ? "played" : "did not play",
        }));
      history = {
        note: "Weeks this season, before the current one, that the player was on the injury report. Compiled from our own records; a gap or 'did not play' can reflect missing data.",
        weeks,
        gamesPlayedWhileListed: weeks.filter((w) => w.result === "played").length,
        gamesMissedWhileListed: weeks.filter((w) => w.result === "did not play").length,
      };
    }
    // Only Sleeper-sourced fields - probabilityOfPlaying/irWeeks are our own
    // derived judgments, and feeding them back in would just echo them.
    return {
      player: {
        name: player?.name ?? "Unknown",
        position: player?.position ?? null,
        team: player?.team ?? null,
      },
      injury: {
        status: injury.status,
        bodyPart: injury.injuryType || null,
        comment: injury.comment || null,
        practiceReport: {
          injury: injury.practiceReportInjuryType,
          day1: injury.practice1,
          day2: injury.practice2,
          day3: injury.practice3,
        },
        lastUpdated: new Date(injury.updatedAt).toISOString().slice(0, 10),
      },
      nfl: nflState
        ? { season: nflState.season, week: nflState.week, seasonType: nflState.seasonType }
        : null,
      schedule,
      history,
    };
  },
});

export const assessInjury = action({
  args: { injuryId: v.id("injuries") },
  handler: async (
    ctx,
    args,
  ): Promise<JevResponse & { overrides: Record<string, string> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const state = await ctx.runQuery(
      internal.infinileague.injuryAssessment.getInjuryState,
      args,
    );
    const response = await askJev(state, QUESTIONS);
    // Hard rule: a player on IR/Out/PUP/etc. can't play, whatever the model says.
    const status = state.injury.status;
    if (CANNOT_PLAY_STATUSES.has(status) && response.answers.plays_next_game?.type === "noul") {
      response.answers.plays_next_game = { type: "noul", noul: 0 };
      return { ...response, overrides: { plays_next_game: `Status "${status}"` } };
    }
    return { ...response, overrides: {} };
  },
});
