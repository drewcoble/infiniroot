import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { requireDraftOwner } from "../../lib/access";
import { resolveDraftType } from "../../draftType";
import { resolveTeamPositionInRound } from "../draft/pickOrder";
import { countForfeitedByRound, countRealSlotsThroughRound } from "../draft/pickSlots";
import { upsertSyncStatus } from "../draft/draftSyncShared";
import {
  fetchYahooDraftResults,
  fetchYahooDraftStatus,
  fetchYahooPlayersByKeys,
} from "./league";
import { withYahooToken } from "./oauth";

// Live sync from an in-progress Yahoo draft into this app's own draftPicks -
// mirrors convex/sleeper/draftSync.ts's self-rescheduling internalAction
// poll chain (see that file's comment for why: neither provider has
// webhooks, and a cron can't be parameterized per-draft or turned off
// cleanly). See schema.ts's drafts.yahoo* fields for the design.
//
// Key differences from Sleeper: Yahoo needs a per-user OAuth token on every
// poll hop (withYahooToken below - Sleeper's API needs none), Yahoo
// addresses everything via seasons.yahooLeagueKey directly (no separate
// draft-id resolution step the way Sleeper needs sleeperLeagueId -> draft_id),
// and - the single biggest unverified assumption behind this whole file -
// fetchYahooDraftResults (/league/{leagueKey}/draftresults) has only ever
// been called against a COMPLETED Yahoo draft until now (the historical/
// keeper-price importer). Whether it returns picks incrementally mid-draft,
// the entire premise of this feature, needs confirming against a real live
// draft. See YAHOO.md.
//
// More conservative than Sleeper's 3s/60s cadence - Yahoo's rate limits are
// less documented/generous than Sleeper's fully-public API.
const FAST_INTERVAL_MS = 7_000;
const SLOW_INTERVAL_MS = 60_000;
// After this many consecutive failed polls, auto-disable rather than retry
// forever silently - see recordSyncError.
const MAX_CONSECUTIVE_FAILURES = 10;

// Yahoo's player_key convention is "{game_key}.p.{numericId}" - already
// relied on unquestioned for league_key/team_key parsing elsewhere in this
// integration, so lower risk than most other Yahoo guesses. Returns null
// for anything that doesn't match (never thrown - a DST player_key still
// needs this to fail cleanly so the name-match fallback path picks it up).
function parseYahooPlayerNumericId(playerKey: string): number | null {
  const match = /\.p\.(\d+)$/.exec(playerKey);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) ? id : null;
}

// Bumps yahooSyncGeneration and flips the draft into sync-enabled state -
// same stale-chain-supersession purpose as Sleeper's enableSync (a poll
// chain from a prior enable/disable/enable cycle recognizes on its next hop
// that it's been superseded and stops, instead of two chains ever polling
// the same draft in parallel).
export const enableSync = internalMutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<number> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error("Draft not found.");
    const generation = (draft.yahooSyncGeneration ?? 0) + 1;
    await ctx.db.patch(args.draftId, {
      yahooSyncEnabled: true,
      yahooSyncGeneration: generation,
    });
    await upsertSyncStatus(ctx, args.draftId, {
      syncError: undefined,
      syncErrorCount: undefined,
    });
    return generation;
  },
});

// Links this season's real draft to its Yahoo league's current live draft
// and kicks off the poll chain. Requires every seasonTeam to already be
// mapped to a Yahoo team (Season Settings' team-mapping step) so picks
// don't start silently getting skipped mid-draft, and - for snake/linear -
// requires the in-app Draft Order (drafts.draftOrder/reversalRounds,
// Settings' Teams panel) to already be configured, since a synced pick's
// round/pickInRound is computed from *our* configured order
// (resolveTeamPositionInRound below), not re-derived from Yahoo's own
// numbering.
//
// Unlike Sleeper's linkSleeperDraft, this does NOT cross-validate the real
// draft's type (auction vs. snake) against a live Yahoo field before
// enabling - the only established in-repo signal for that
// (picks.some(p => p.cost !== undefined), see fetchPreviousYahooSeasonPreview
// below) needs picks to already exist, which isn't the case before a draft
// starts. v1 trusts the season's own already-configured draftType instead -
// worth revisiting once a live test confirms a reliable pre-draft signal.
export const linkYahooDraft = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ ok: true }> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.yahooLeagueKey) {
      throw new Error("Link a Yahoo league first.");
    }

    const draft = await ctx.runQuery(
      internal.infinidraft.draft.draftSyncShared.loadRealDraftForLink,
      { seasonId: args.seasonId },
    );

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );
    if (teams.length === 0 || teams.some((t) => !t.yahooTeamKey)) {
      throw new Error(
        "Map every team to a Yahoo team (above) before enabling live sync.",
      );
    }

    const mode = resolveDraftType(season, draft);
    if (mode !== "auction" && (!draft.draftOrder || draft.draftOrder.length === 0)) {
      throw new Error(
        "Set the draft order (Settings' Teams panel) to match Yahoo's real draft order before enabling live sync.",
      );
    }

    const generation: number = await ctx.runMutation(
      internal.infinidraft.yahoo.draftSync.enableSync,
      { draftId: draft._id },
    );

    await ctx.scheduler.runAfter(
      0,
      internal.infinidraft.yahoo.draftSync.syncYahooDraft,
      { draftId: draft._id, generation },
    );

    return { ok: true };
  },
});

// The chain notices this on its own next hop (draftSyncShared's
// loadSyncStateInternal) and stops rescheduling - up to one poll interval of
// latency, same as Sleeper's disableLiveSync.
export const disableLiveSync = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    await ctx.db.patch(draft._id, { yahooSyncEnabled: false });
    return null;
  },
});

// Fresh re-read of season+league for the poll loop's per-hop token lookup
// (league.ownerId, for withYahooToken) - no auth check, since this is
// internal/not user-facing and authorization already happened at link time
// via linkYahooDraft above, same trust model as draftSyncShared's
// loadSyncStateInternal.
export const loadYahooSyncSeasonAndLeague = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ season: Doc<"seasons">; league: Doc<"leagues"> } | null> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    const league = await ctx.db.get(season.leagueId);
    if (!league) return null;
    return { season, league };
  },
});

// Called on the slow pre-draft cadence (draft not started yet, Yahoo still
// reports "predraft") - just a heartbeat so the UI's "last checked" readout
// still moves, and a place to clear a stale error once things recover.
export const recordWatchTick = internalMutation({
  args: { draftId: v.id("drafts"), generation: v.number() },
  handler: async (ctx, args): Promise<{ stopped: boolean }> => {
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      !draft.yahooSyncEnabled ||
      draft.yahooSyncGeneration !== args.generation
    ) {
      return { stopped: true };
    }
    await upsertSyncStatus(ctx, args.draftId, {
      lastSyncedAt: Date.now(),
      syncErrorCount: undefined,
      syncError: undefined,
    });
    return { stopped: false };
  },
});

// Applies one poll's worth of Yahoo picks: resolves each pick's team_key to
// a seasonTeams row (a single map - Yahoo has one team identifier, unlike
// Sleeper's rosterId/ownerId fallback pair), then - for snake/linear -
// resolves round/pickInRound/overallPick via the same
// resolveTeamPositionInRound/countRealSlotsThroughRound helpers draftPick,
// addKeeper, and Sleeper's own sync tick use, so a synced pick's slot always
// agrees with the board regardless of Yahoo's own raw pick/round numbering.
// Hands the fully-resolved subset to convex/infinidraft/draft/picks.ts's
// applySyncedDraftPicks for the actual draftPicks writes. A pick with no
// fpid/price (auction) or no resolvable round/position (snake/linear), or
// no mapped team, is skipped rather than thrown, so one bad mapping doesn't
// halt the rest of the draft - the skipped count surfaces to the host via
// draftSyncStatus.syncError.
export const applyYahooSyncTick = internalMutation({
  args: {
    draftId: v.id("drafts"),
    generation: v.number(),
    yahooDraftStatus: v.string(),
    picks: v.array(
      v.object({
        fpid: v.union(v.number(), v.null()),
        price: v.union(v.number(), v.null()),
        round: v.union(v.number(), v.null()),
        pickNo: v.number(),
        teamKey: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ stopped: boolean; applied: number; skipped: number }> => {
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      !draft.yahooSyncEnabled ||
      draft.yahooSyncGeneration !== args.generation
    ) {
      return { stopped: true, applied: 0, skipped: 0 };
    }
    const season = await ctx.db.get(draft.seasonId);
    if (!season) return { stopped: true, applied: 0, skipped: 0 };
    const mode = resolveDraftType(season, draft);

    const teams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", draft.seasonId))
      .collect();
    const teamByYahooTeamKey = new Map(
      teams.filter((t) => t.yahooTeamKey).map((t) => [t.yahooTeamKey as string, t]),
    );

    // Only needed for snake/linear - computed once per tick rather than
    // per-pick, same as Sleeper's tick / draftPick / addKeeper.
    const draftOrder = draft.draftOrder ?? [];
    const reversalRounds = draft.reversalRounds ?? [];
    const teamCount = draftOrder.length;
    const forfeitedByRound =
      mode !== "auction"
        ? await countForfeitedByRound(ctx, draft._id)
        : new Map<number, number>();

    const resolved: Array<{
      fpid: number;
      teamId: Doc<"seasonTeams">["_id"];
      pickNo: number;
      price?: number;
      round?: number;
      pickInRound?: number;
      overallPick?: number;
    }> = [];
    let unresolvedCount = 0;
    for (const pick of args.picks) {
      if (pick.fpid === null) {
        unresolvedCount += 1;
        continue;
      }
      const team = pick.teamKey ? teamByYahooTeamKey.get(pick.teamKey) : undefined;
      if (!team) {
        unresolvedCount += 1;
        continue;
      }

      if (mode === "auction") {
        if (pick.price === null) {
          unresolvedCount += 1;
          continue;
        }
        resolved.push({
          fpid: pick.fpid,
          teamId: team._id,
          pickNo: pick.pickNo,
          price: pick.price,
        });
      } else {
        if (pick.round === null || teamCount === 0) {
          unresolvedCount += 1;
          continue;
        }
        const pickInRound = resolveTeamPositionInRound(
          draftOrder,
          mode,
          reversalRounds,
          pick.round,
          team._id,
        );
        if (pickInRound === null) {
          unresolvedCount += 1;
          continue;
        }
        const overallPick =
          countRealSlotsThroughRound(pick.round - 1, teamCount, forfeitedByRound) +
          pickInRound;
        resolved.push({
          fpid: pick.fpid,
          teamId: team._id,
          pickNo: pick.pickNo,
          round: pick.round,
          pickInRound,
          overallPick,
        });
      }
    }

    const { applied, skipped: unknownPlayerCount } = await ctx.runMutation(
      internal.infinidraft.draft.picks.applySyncedDraftPicks,
      { draftId: args.draftId, picks: resolved },
    );

    const skipped = unresolvedCount + unknownPlayerCount;
    await upsertSyncStatus(ctx, args.draftId, {
      lastSyncedAt: Date.now(),
      syncErrorCount: undefined,
      syncError:
        skipped > 0
          ? `${skipped} pick(s) skipped - unmapped team or player.`
          : undefined,
    });
    // Only the confirmed complete-state value ("postdraft") auto-disables -
    // see fetchYahooDraftStatus's comment on why the in-progress value isn't
    // checked for/against (not confirmed), and why "not predraft" is never
    // treated as "complete" either.
    if (args.yahooDraftStatus === "postdraft") {
      await ctx.db.patch(args.draftId, { yahooSyncEnabled: false });
    }

    return { stopped: false, applied, skipped };
  },
});

// On a fetch/apply failure: record the error, back off (simple linear
// increase, same shape as Sleeper's recordSyncError, capped higher - 120s
// vs Sleeper's 60s - since a Yahoo failure is more likely to be a 429
// against undocumented rate limits, warranting a longer cool-down), and
// auto-disable after MAX_CONSECUTIVE_FAILURES so a persistently bad league
// key or a Yahoo outage doesn't retry forever unattended.
export const recordSyncError = internalMutation({
  args: { draftId: v.id("drafts"), generation: v.number(), message: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ stopped: boolean; nextDelayMs: number }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.yahooSyncGeneration !== args.generation) {
      return { stopped: true, nextDelayMs: 0 };
    }
    const status = await ctx.db
      .query("draftSyncStatus")
      .withIndex("by_draft", (q) => q.eq("draftId", args.draftId))
      .unique();
    const errorCount = (status?.syncErrorCount ?? 0) + 1;
    const disabled = errorCount >= MAX_CONSECUTIVE_FAILURES;
    await upsertSyncStatus(ctx, args.draftId, {
      syncError: args.message,
      syncErrorCount: errorCount,
    });
    if (disabled) {
      await ctx.db.patch(args.draftId, { yahooSyncEnabled: false });
    }
    return {
      stopped: disabled,
      nextDelayMs: Math.min(
        FAST_INTERVAL_MS + errorCount * FAST_INTERVAL_MS,
        120_000,
      ),
    };
  },
});

// The poll loop itself. Each hop: reload state (stop if disabled/
// superseded/unlinked), resolve the Yahoo access token for the league
// owner, fetch the Yahoo league's draft_status, auto-start the in-app draft
// reactively once status leaves "predraft" (no pre-emptive scheduled-time
// window the way Sleeper's poller has - see this file's header comment),
// fetch draft results, resolve each pick's player_key to an fpid (numeric
// id first, name-match fallback for the rest - see the resolution block
// below), apply new ones, then reschedule itself - fast while picks might
// be flowing, slow while just watching for the draft to start, or not at
// all once stopped/complete/disabled.
export const syncYahooDraft = internalAction({
  args: { draftId: v.id("drafts"), generation: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.runQuery(
      internal.infinidraft.draft.draftSyncShared.loadSyncStateInternal,
      { draftId: args.draftId },
    );
    if (
      !draft ||
      !draft.yahooSyncEnabled ||
      draft.yahooSyncGeneration !== args.generation
    ) {
      return null;
    }

    const context = await ctx.runQuery(
      internal.infinidraft.yahoo.draftSync.loadYahooSyncSeasonAndLeague,
      { seasonId: draft.seasonId },
    );
    if (!context) return null;
    const { season, league } = context;
    const yahooLeagueKey = season.yahooLeagueKey;
    if (!yahooLeagueKey) return null;

    try {
      await withYahooToken(ctx, league.ownerId, async (accessToken) => {
        const draftStatus = await fetchYahooDraftStatus(accessToken, yahooLeagueKey);

        if (draft.startedAt === undefined) {
          // "predraft" (confirmed) or unconfirmed/unreadable status both
          // mean "keep waiting" - starting the in-app draft on unconfirmed
          // data is a worse mistake than staying in the watch phase a bit
          // longer.
          if (draftStatus === undefined || draftStatus === "predraft") {
            const tick = await ctx.runMutation(
              internal.infinidraft.yahoo.draftSync.recordWatchTick,
              { draftId: args.draftId, generation: args.generation },
            );
            if (!tick.stopped) {
              await ctx.scheduler.runAfter(
                SLOW_INTERVAL_MS,
                internal.infinidraft.yahoo.draftSync.syncYahooDraft,
                args,
              );
            }
            return;
          }
          await ctx.runMutation(
            internal.infinidraft.draft.lifecycle.startDraftForSyncInternal,
            { draftId: args.draftId },
          );
        }

        const draftResults = await fetchYahooDraftResults(accessToken, yahooLeagueKey);

        // Primary resolution: parse the numeric id out of each player_key
        // and look it up via players.by_yahoo_id in one batched query - see
        // resolveFpidsByYahooId's comment for why this isn't confirmed live
        // yet. Every pick is re-resolved every tick (not just new ones,
        // same as Sleeper's poller re-derives everything every hop) - cheap
        // relative to the API calls, and applySyncedDraftPicks' own dedup
        // makes re-resolving an already-applied pick harmless.
        const numericIdByPlayerKey = new Map<string, number>();
        for (const pick of draftResults) {
          const numericId = parseYahooPlayerNumericId(pick.playerKey);
          if (numericId !== null) numericIdByPlayerKey.set(pick.playerKey, numericId);
        }
        const numericMatches =
          numericIdByPlayerKey.size > 0
            ? await ctx.runQuery(internal.infinidraft.yahoo.league.resolveFpidsByYahooId, {
                playerIds: [...new Set(numericIdByPlayerKey.values())],
              })
            : [];
        const fpidByNumericId = new Map(numericMatches.map((m) => [m.playerId, m.fpid]));

        const fpidByPlayerKey = new Map<string, number>();
        const unresolvedPlayerKeys: string[] = [];
        for (const pick of draftResults) {
          const numericId = numericIdByPlayerKey.get(pick.playerKey);
          const fpid = numericId !== undefined ? fpidByNumericId.get(numericId) : undefined;
          if (fpid !== undefined) {
            fpidByPlayerKey.set(pick.playerKey, fpid);
          } else {
            unresolvedPlayerKeys.push(pick.playerKey);
          }
        }

        // Fallback resolution (mostly DST, which has no yahooId, plus any
        // numeric-id crosswalk miss) - name+position match via the same
        // machinery the historical/keeper-price importer uses, batched
        // through one Yahoo request for whatever the numeric path couldn't
        // resolve.
        if (unresolvedPlayerKeys.length > 0) {
          const playersByKey = await fetchYahooPlayersByKeys(accessToken, unresolvedPlayerKeys);
          const playerList = [...playersByKey.entries()].map(([playerKey, info]) => ({
            playerKey,
            name: info.name,
            position: info.position,
            ...(info.teamAbbr ? { teamAbbr: info.teamAbbr } : {}),
          }));
          const fallbackMatches = await ctx.runQuery(
            internal.infinidraft.yahoo.league.resolvePlayerKeysToFpids,
            { players: playerList },
          );
          for (const m of fallbackMatches) fpidByPlayerKey.set(m.playerKey, m.fpid);
          // Diagnostic for the live-test checklist (numeric resolution hit
          // rate) - anything still unresolved after both passes.
          for (const playerKey of unresolvedPlayerKeys) {
            if (!fpidByPlayerKey.has(playerKey)) {
              console.error(
                "syncYahooDraft: unresolved player_key after numeric + name-match lookup:",
                playerKey,
              );
            }
          }
        }

        const result = await ctx.runMutation(
          internal.infinidraft.yahoo.draftSync.applyYahooSyncTick,
          {
            draftId: args.draftId,
            generation: args.generation,
            yahooDraftStatus: draftStatus ?? "",
            picks: draftResults.map((pick, index) => ({
              fpid: fpidByPlayerKey.get(pick.playerKey) ?? null,
              price: pick.cost ?? null,
              round: pick.round ?? null,
              pickNo: pick.pick ?? index + 1,
              teamKey: pick.teamKey || null,
            })),
          },
        );

        if (!result.stopped && draftStatus !== "postdraft") {
          await ctx.scheduler.runAfter(
            FAST_INTERVAL_MS,
            internal.infinidraft.yahoo.draftSync.syncYahooDraft,
            args,
          );
        }
      });
    } catch (err) {
      const outcome = await ctx.runMutation(
        internal.infinidraft.yahoo.draftSync.recordSyncError,
        {
          draftId: args.draftId,
          generation: args.generation,
          message: err instanceof Error ? err.message : String(err),
        },
      );
      if (!outcome.stopped) {
        await ctx.scheduler.runAfter(
          outcome.nextDelayMs,
          internal.infinidraft.yahoo.draftSync.syncYahooDraft,
          args,
        );
      }
    }
    return null;
  },
});
