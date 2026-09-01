"use node";

import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireSuperAdmin } from "./client";

/**
 * Sleeper's full player directory (undocumented, no auth, ~12k entries /
 * ~15MB) - distinct from the trimmed per-player object nested in the
 * projections/stats endpoints (see convex/sleeper/client.ts's fetchSleeper),
 * which omits espn_id/yahoo_id entirely. This is the only Sleeper endpoint
 * that carries them, so it's fetched as its own one-off sync rather than
 * folded into the daily projections fetch. Runs in the Node action runtime
 * (not the default V8 one) for the large response body.
 */
const PLAYERS_API_URL = "https://api.sleeper.app/v1/players/nfl";

interface SleeperFullPlayer {
  player_id: string;
  espn_id?: number | null;
  yahoo_id?: number | null;
}

async function fetchSleeperPlayerLinksHandler(
  ctx: ActionCtx,
): Promise<{ patched: number; skipped: number; scanned: number }> {
  const response = await fetch(PLAYERS_API_URL);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Sleeper players request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }

  const players: Record<string, SleeperFullPlayer> = await response.json();

  const rows: Array<{ fpid: number; espnId?: number; yahooId?: number }> = [];
  for (const player of Object.values(players)) {
    // Only real (numeric-id) players carry espn_id/yahoo_id here - DST rows
    // use team abbreviations as their player_id and map to our synthetic
    // DEF_TEAM_FPIDS instead (see ./client.ts), which this endpoint knows
    // nothing about.
    const fpid = Number(player.player_id);
    if (!Number.isFinite(fpid)) continue;

    const espnId = player.espn_id ?? undefined;
    const yahooId = player.yahoo_id ?? undefined;
    if (espnId === undefined && yahooId === undefined) continue;

    rows.push({
      fpid,
      ...(espnId !== undefined ? { espnId } : {}),
      ...(yahooId !== undefined ? { yahooId } : {}),
    });
  }

  // Chunked rather than one runMutation call for the whole list - each row
  // costs a read (existing-player lookup) plus a possible write, and the
  // full list is well past Convex's 4096-reads-per-transaction limit.
  const CHUNK_SIZE = 500;
  let patched = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const result = await ctx.runMutation(internal.players.patchExternalIds, {
      rows: chunk,
    });
    patched += result.patched;
    skipped += result.skipped;
  }

  return { patched, skipped, scanned: rows.length };
}

export const fetchSleeperPlayerLinks = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ patched: number; skipped: number; scanned: number }> => {
    await requireSuperAdmin(ctx);
    return await fetchSleeperPlayerLinksHandler(ctx);
  },
});

// Cron-safe counterpart with no human-auth check - see fetchAllData.ts's
// fetchAllInternal for why this split exists.
export const fetchSleeperPlayerLinksInternal = internalAction({
  args: {},
  handler: async (ctx) => await fetchSleeperPlayerLinksHandler(ctx),
});
