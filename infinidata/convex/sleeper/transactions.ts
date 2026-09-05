import { v } from "convex/values";
import { internalAction, internalQuery } from "../_generated/server";
import { internal, api } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { fetchCurrentNflWeek } from "./state";
import { nextWeeklyOccurrence, nextDailyOccurrence } from "../lib/timezone";

/**
 * Computes infinifaab's waiver-eligibility for a Sleeper-linked season -
 * see schema.ts's waiverPlayers/seasons.waiverDayOfWeek comments and
 * AUCTION_PLAN's "Waiver-eligibility data" section for the full context.
 * Sleeper has no live "is this player on waivers right now" endpoint (see
 * that plan section), so this derives it: pull recent drop events from
 * GET /league/{id}/transactions/{round}, then compute each drop's clear
 * time from the league's own waiver-clearing settings (confirmed live
 * field names - see schema.ts's seasons.waiverDayOfWeek comment) plus, for
 * "After Games" mode, the dropped player's own NFL game time this week
 * (convex/tank01/schedule.ts).
 *
 * The "After Games" formula (dailyWaivers false/absent) is a documented
 * approximation, not a byte-exact port of Sleeper's own scheduler: Sleeper
 * support docs describe "next waiverDayOfWeek after the player's game ends"
 * but don't publish an exact clock time for that day, and Tank01's
 * schedule gives kickoff only (not a real final-whistle timestamp - see
 * schedule.ts's ESTIMATED_GAME_LENGTH_MS). Deliberately conservative in one
 * direction only: every approximation here (the AFTER_GAMES_CLEAR_HOUR
 * guess, the game-length estimate) can only push a computed clearsAt LATER
 * than the real one, never earlier - so the worst case is a player
 * appearing on infinifaab's board a little after they'd already be
 * addable on Sleeper, never a bid on someone who (from this app's
 * perspective) should still be locked. closeCycle re-checks eligibility
 * again right before freezing a winner regardless (see AUCTION_PLAN).
 */

interface SleeperTransaction {
  status: string;
  created: number;
  drops: Record<string, string> | null;
}

async function fetchSleeperTransactionsForRound(
  sleeperLeagueId: string,
  round: string,
): Promise<SleeperTransaction[]> {
  const response = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/transactions/${round}`,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sleeper transactions request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
  return await response.json();
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Sleeper's own support docs give "12:05 a.m. PST on Wednesday" as one real
// "After Games" clear example - this mirrors that "shortly after midnight"
// convention rather than inventing an unrelated hour. See this file's
// header comment on why an approximate hour here is safe to be wrong about.
const AFTER_GAMES_CLEAR_HOUR = 0;
// This app has no per-league timezone setting captured from Sleeper (not
// exposed on the settings payload this app reads) - reuses the same
// America/New_York default the rest of infinifaab's scheduling assumes.
const APP_TIME_ZONE = "America/New_York";

// Tank01's team abbreviation for Washington ("WSH") doesn't match this
// app's Sleeper-derived players.team convention ("WAS") - the one known
// mismatch across all 32 teams, same discrepancy convex/tank01/
// depthChartsData.ts documents for depth charts.
const TANK01_TO_OUR_TEAM: Record<string, string> = { WSH: "WAS" };

function normalizeTank01Team(team: string): string {
  return TANK01_TO_OUR_TEAM[team] ?? team;
}

function computeClearsAt(
  droppedAt: number,
  season: Doc<"seasons">,
  team: string | null,
  gameEndByTeam: Map<string, number>,
): number {
  if (season.dailyWaivers === true && season.dailyWaiversHour !== undefined) {
    return nextDailyOccurrence(droppedAt, season.dailyWaiversHour, 0, APP_TIME_ZONE);
  }

  const clearDays = season.waiverClearDays ?? 0;
  let candidate = droppedAt + clearDays * DAY_MS;

  if (season.waiverDayOfWeek !== undefined) {
    const nextClearDay = nextWeeklyOccurrence(
      droppedAt,
      season.waiverDayOfWeek,
      AFTER_GAMES_CLEAR_HOUR,
      0,
      APP_TIME_ZONE,
    );
    candidate = Math.max(candidate, nextClearDay);
  }

  // Never let a player clear before their own game this week ends - the
  // core intent of "After Games" mode.
  const gameEnd = team ? gameEndByTeam.get(team) : undefined;
  if (gameEnd !== undefined) {
    candidate = Math.max(candidate, gameEnd);
  }

  return candidate;
}

// No auth check - only ever called from our own cron-triggered orchestrator
// (convex/infinileague/auction/waiverSync.ts), never exposed publicly. Same
// "cron has no signed-in user" reasoning as fetchAllData.ts's
// fetchAllInternal split.
export const getSeasonForWaiverSync = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<Doc<"seasons"> | null> => {
    return await ctx.db.get(args.seasonId);
  },
});

export const syncSleeperWaiverPlayers = internalAction({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ upserted: number }> => {
    const season = await ctx.runQuery(
      internal.sleeper.transactions.getSeasonForWaiverSync,
      { seasonId: args.seasonId },
    );
    if (!season || !season.sleeperLeagueId) {
      return { upserted: 0 };
    }

    const week = await fetchCurrentNflWeek();
    // "0" is the offseason/draft-prep sentinel (see fetchAllData.ts) - no
    // real transactions round to check. Otherwise check this week's round
    // and last week's, since a drop late last week could still be within
    // its waiver window now.
    const rounds =
      week === "0"
        ? []
        : [...new Set([week, String(Math.max(1, Number(week) - 1))])];

    const droppedAtByFpid = new Map<number, number>();
    for (const round of rounds) {
      const transactions = await fetchSleeperTransactionsForRound(
        season.sleeperLeagueId,
        round,
      );
      for (const txn of transactions) {
        if (txn.status !== "complete" || !txn.drops) continue;
        for (const playerId of Object.keys(txn.drops)) {
          // fpid IS Sleeper's numeric player_id in this app (see
          // convex/sleeper/playerLinks.ts) - DST rows use a team
          // abbreviation as their Sleeper id instead, which Number()
          // correctly rejects here (waivers on defenses aren't modeled).
          const fpid = Number(playerId);
          if (!Number.isFinite(fpid)) continue;
          const existing = droppedAtByFpid.get(fpid);
          if (existing === undefined || txn.created > existing) {
            droppedAtByFpid.set(fpid, txn.created);
          }
        }
      }
    }

    if (droppedAtByFpid.size === 0) {
      await ctx.runMutation(
        internal.infinileague.auction.waiverPlayersData.replaceWaiverPlayersForSeason,
        { seasonId: args.seasonId, rows: [] },
      );
      return { upserted: 0 };
    }

    const fpids = [...droppedAtByFpid.keys()];
    const players = await ctx.runQuery(api.players.getPlayersByFpids, { fpids });
    const teamByFpid = new Map(players.map((p) => [p.fpid, p.team]));

    const games =
      week === "0"
        ? []
        : await ctx.runQuery(api.tank01.scheduleData.listGamesForWeek, {
            season: season.year,
            week,
          });
    const gameEndByTeam = new Map<string, number>();
    for (const game of games) {
      gameEndByTeam.set(normalizeTank01Team(game.homeTeam), game.estimatedEndAt);
      gameEndByTeam.set(normalizeTank01Team(game.awayTeam), game.estimatedEndAt);
    }

    const now = Date.now();
    const rows: Array<{ fpid: number; clearsAt: number }> = [];
    for (const [fpid, droppedAt] of droppedAtByFpid) {
      const clearsAt = computeClearsAt(
        droppedAt,
        season,
        teamByFpid.get(fpid) ?? null,
        gameEndByTeam,
      );
      if (clearsAt > now) {
        rows.push({ fpid, clearsAt });
      }
    }

    await ctx.runMutation(
      internal.infinileague.auction.waiverPlayersData.replaceWaiverPlayersForSeason,
      { seasonId: args.seasonId, rows },
    );
    return { upserted: rows.length };
  },
});
