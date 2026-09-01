"use node";

import { v } from "convex/values";
import { action, internalAction, ActionCtx } from "../_generated/server";
import { internal, api } from "../_generated/api";
import { Doc } from "../_generated/dataModel";
import {
  requireSuperAdmin,
  currentSeason,
  fetchEspnPlayers,
  EspnPlayer,
} from "./client";
import { normalizePlayerName } from "../playerNameMatch";
import { BLENDED_POSITIONS, BlendedPosition } from "../positions";

// ESPN's defaultPositionId, confirmed empirically against players already
// linked via espnId (see conversation history / git blame - cross-referencing
// thousands of matched players showed a clean majority mapping with only a
// handful of eligibility-slot noise). DST isn't included: our DST fpids are
// synthetic (see DEF_TEAM_FPIDS in convex/sleeper/client.ts) and never carry
// an espnId, so a defense can never resolve through either match path below.
const ESPN_POSITION_TO_OURS: Record<number, Doc<"players">["position"]> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
};

const BLENDED_POSITIONS_SET = new Set<string>(BLENDED_POSITIONS);
function isBlendedPosition(
  position: Doc<"players">["position"],
): position is BlendedPosition {
  return BLENDED_POSITIONS_SET.has(position);
}

type EspnFormat = Doc<"standardValues">["format"];

// ESPN's draftRanksByRankType keys, confirmed live to be exactly these four:
// STANDARD/PPR/SUPERFLEX/ELIMINATION - no half-PPR variant exists anywhere
// in this endpoint. ELIMINATION is a single-elimination survivor game mode,
// not a redraft scoring format, so it's deliberately excluded here.
const ESPN_RANK_TYPE_TO_FORMAT: Record<string, EspnFormat> = {
  STANDARD: "standard",
  PPR: "ppr",
  SUPERFLEX: "superflex",
};
const ESPN_FORMATS = Object.keys(ESPN_RANK_TYPE_TO_FORMAT);

// ESPN's numeric stat ids, mapped to this app's shared stat-category
// vocabulary (Sleeper's own naming - see sleeper/projections.ts's
// numericStats). Empirically derived, not from any published ESPN schema:
// computed the ratio of each candidate ESPN id's value against every
// Sleeper stat category across ~300-400 players matched between the two
// sources, keeping only ids whose median ratio landed near 1.0 with a
// realistic (not identical-source) spread. Two-point conversions have no
// reliable candidate id and are omitted - see computeProjectedPoints in
// convex/scoring.ts for the same gap and why it's an accepted one.
const ESPN_STAT_ID_TO_CATEGORY: Record<string, string> = {
  "3": "pass_yd",
  "4": "pass_td",
  "20": "pass_int",
  "24": "rush_yd",
  "25": "rush_td",
  "42": "rec_yd",
  "43": "rec_td",
  "53": "rec",
  "72": "fum_lost",
};

// Pulls one player's raw projected stat line for a given season/week out of
// ESPN's per-period stats array (scoringPeriodId 0 = season-long, matching
// this app's own "0" season-long sentinel; statSourceId 1 = projected).
function extractEspnStats(
  player: EspnPlayer,
  season: string,
  week: string,
): Record<string, number> | undefined {
  const scoringPeriodId = week === "0" ? 0 : Number(week);
  const block = player.stats?.find(
    (s) =>
      s.statSourceId === 1 &&
      s.seasonId === Number(season) &&
      s.scoringPeriodId === scoringPeriodId,
  );
  if (!block) return undefined;

  const stats: Record<string, number> = {};
  for (const [espnId, category] of Object.entries(ESPN_STAT_ID_TO_CATEGORY)) {
    const value = block.stats[espnId];
    if (value !== undefined) stats[category] = value;
  }
  return Object.keys(stats).length > 0 ? stats : undefined;
}

export interface EspnSyncResult {
  totalPlayers: number;
  directMatched: number;
  nameMatched: number;
  ambiguous: number;
  unmatched: number;
  ambiguousSample: string[];
  unmatchedSample: string[];
  rowsByFormat: Record<EspnFormat, number>;
  statRowsByPosition: Record<string, number>;
}

async function fetchEspnRankingsHandler(
  ctx: ActionCtx,
  args: { season?: string; week?: string },
): Promise<EspnSyncResult> {
  const season = args.season ?? currentSeason();
  const week = args.week ?? "0";
  const espnPlayers = await fetchEspnPlayers(season);

  const ourPlayers = await ctx.runQuery(internal.players.listForNameMatch, {});

  const byEspnId = new Map<number, number>(); // espnId -> fpid
  // normalizedName|position -> candidate fpids that don't already carry a
  // (different) espnId - a candidate that's already linked is never a valid
  // fallback target, so it's excluded up front rather than filtered per row.
  const byNamePosition = new Map<string, number[]>();
  for (const player of ourPlayers) {
    if (player.espnId !== undefined) {
      byEspnId.set(player.espnId, player.fpid);
      continue;
    }
    const key = `${normalizePlayerName(player.name)}|${player.position}`;
    const candidates = byNamePosition.get(key) ?? [];
    candidates.push(player.fpid);
    byNamePosition.set(key, candidates);
  }

  const valueRowsByFormat: Record<
    EspnFormat,
    Array<{ fpid: number; rank: number; auctionValue: number }>
  > = { standard: [], ppr: [], superflex: [] };
  const statRowsByPosition: Record<
    BlendedPosition,
    Array<{ fpid: number; stats: Record<string, number> }>
  > = { QB: [], RB: [], WR: [], TE: [] };
  const newLinks: Array<{ fpid: number; espnId: number }> = [];
  let directMatched = 0;
  let nameMatched = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const ambiguousSample: string[] = [];
  const unmatchedSample: string[] = [];

  for (const player of espnPlayers) {
    // ESPN's id scheme also carries synthetic "team QB" streaming
    // placeholders (negative ids, e.g. "Bills TQB") alongside real players -
    // these can never have a matching players.espnId, so skip explicitly.
    if (player.id <= 0) continue;

    const ranks = player.draftRanksByRankType;
    const hasAnyRank = ESPN_FORMATS.some(
      (rankType) => ranks?.[rankType]?.rank !== undefined,
    );
    if (!hasAnyRank) continue;

    const ourPosition = ESPN_POSITION_TO_OURS[player.defaultPositionId ?? -1];

    const directFpid = byEspnId.get(player.id);
    let fpid: number | undefined = directFpid;

    if (fpid !== undefined) {
      directMatched += 1;
    } else {
      const key = ourPosition
        ? `${normalizePlayerName(player.fullName ?? "")}|${ourPosition}`
        : undefined;
      const candidates = key ? (byNamePosition.get(key) ?? []) : [];
      const [onlyCandidate] = candidates;

      if (candidates.length === 1 && onlyCandidate !== undefined) {
        fpid = onlyCandidate;
        newLinks.push({ fpid, espnId: player.id });
        nameMatched += 1;
      } else if (candidates.length > 1) {
        ambiguous += 1;
        if (ambiguousSample.length < 15) {
          ambiguousSample.push(player.fullName ?? String(player.id));
        }
      } else {
        unmatched += 1;
        if (unmatchedSample.length < 15) {
          unmatchedSample.push(player.fullName ?? String(player.id));
        }
      }
    }

    if (fpid === undefined) continue;

    for (const [rankType, format] of Object.entries(ESPN_RANK_TYPE_TO_FORMAT)) {
      const rankInfo = ranks?.[rankType];
      if (rankInfo?.rank === undefined) continue;
      valueRowsByFormat[format].push({
        fpid,
        rank: rankInfo.rank,
        auctionValue: rankInfo.auctionValue ?? 0,
      });
    }

    if (ourPosition && isBlendedPosition(ourPosition)) {
      const stats = extractEspnStats(player, season, week);
      if (stats) {
        statRowsByPosition[ourPosition].push({ fpid, stats });
      }
    }
  }

  // Chunked rather than one runMutation call for the whole list - each row
  // costs at least a read plus a possible write, and the full lists are well
  // past Convex's 4096-reads-per-transaction limit.
  const CHUNK_SIZE = 500;
  for (let i = 0; i < newLinks.length; i += CHUNK_SIZE) {
    await ctx.runMutation(internal.players.patchExternalIds, {
      rows: newLinks.slice(i, i + CHUNK_SIZE),
    });
  }

  const rowsByFormat: Record<EspnFormat, number> = {
    standard: 0,
    ppr: 0,
    superflex: 0,
  };
  for (const format of Object.keys(valueRowsByFormat) as EspnFormat[]) {
    const rows = valueRowsByFormat[format];
    rowsByFormat[format] = rows.length;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await ctx.runMutation(internal.standardValues.upsertEspnValues, {
        format,
        season,
        rows: rows.slice(i, i + CHUNK_SIZE),
      });
    }
  }

  const statRowCounts: Record<string, number> = {};
  for (const position of Object.keys(statRowsByPosition) as BlendedPosition[]) {
    const rows = statRowsByPosition[position];
    statRowCounts[position] = rows.length;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await ctx.runMutation(
        api.providerProjections.upsertProviderProjections,
        {
          provider: "espn",
          position,
          season,
          week,
          rows: rows.slice(i, i + CHUNK_SIZE),
        },
      );
    }
  }

  return {
    totalPlayers: directMatched + nameMatched + ambiguous + unmatched,
    directMatched,
    nameMatched,
    ambiguous,
    unmatched,
    ambiguousSample,
    unmatchedSample,
    rowsByFormat,
    statRowsByPosition: statRowCounts,
  };
}

export const fetchEspnRankings = action({
  args: { season: v.optional(v.string()), week: v.optional(v.string()) },
  handler: async (ctx, args): Promise<EspnSyncResult> => {
    await requireSuperAdmin(ctx);
    return await fetchEspnRankingsHandler(ctx, args);
  },
});

// Cron-safe counterpart with no human-auth check - see fetchAllData.ts's
// fetchAllInternal for why this split exists.
export const fetchEspnRankingsInternal = internalAction({
  args: { season: v.optional(v.string()), week: v.optional(v.string()) },
  handler: fetchEspnRankingsHandler,
});
