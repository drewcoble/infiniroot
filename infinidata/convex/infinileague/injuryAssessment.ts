import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { askJev, type JevQuestion, type JevResponse } from "../jev/client";

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
  fantasy_action: {
    type: "choice",
    instructions:
      "In a redraft (no keepers) season-long fantasy football league, what should a manager who rosters `player` do this week given `injury`?",
    criteria: {
      start: "Start with confidence",
      start_risky: "Start, but with real downside risk from the injury",
      bench: "Bench this week, keep rostered",
      stash_ir: "Move to an IR slot and hold - expected back in time to help this season",
      drop: "Safe to drop - not expected to contribute again this season",
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
    };
  },
});

export const assessInjury = action({
  args: { injuryId: v.id("injuries") },
  handler: async (ctx, args): Promise<JevResponse> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("You must be signed in.");
    const state = await ctx.runQuery(
      internal.infinileague.injuryAssessment.getInjuryState,
      args,
    );
    return await askJev(state, QUESTIONS);
  },
});
