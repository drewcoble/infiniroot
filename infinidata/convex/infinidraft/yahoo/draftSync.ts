import { v } from "convex/values";
import type { ActionCtx } from "../../_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import { requireDraftOwner } from "../../lib/access";
import { resolveDraftType } from "../../draftType";
import { resolveTeamPositionInRound } from "../draft/pickOrder";
import { countForfeitedByRound, countRealSlotsThroughRound } from "../draft/pickSlots";
import { syncDraftStatus } from "../draft/status";
import { upsertSyncStatus } from "../draft/draftSyncShared";
import { expandRosterSlots } from "../../lib/rosterSlots";
import { invalidateDraftValues } from "../../draftValues";
import { positionValidator } from "../../positions";
import { scoringValidator, teScoringValidator } from "../../scoring";
import {
  fetchYahooDraftResults,
  fetchYahooDraftStatus,
  fetchYahooLeagueSettings,
  fetchYahooPlayersByKeys,
} from "./league";
import {
  mapYahooRosterPositions,
  mapYahooScoringSettings,
  mapYahooSixPointPassTds,
  mapYahooTeScoring,
} from "./leagueSettingsMapping";
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
const FAST_INTERVAL_MS = 4_500;
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
// Settings' Teams panel) to already be configured, since resolveTeamPositionInRound
// below needs *some* order to compute round/pickInRound the instant the
// first picks arrive. This is only ever a placeholder, though - Yahoo
// doesn't expose the real order pre-draft (confirmed live 2026-09-08: it's
// revealed only once the draft room opens), so applyYahooSyncTick derives
// the real slot-by-slot order from round 1's own picks the moment they come
// in and overwrites whatever was configured here with it - see that
// function's comment.
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

const yahooResyncRosterSlotsValidator = v.object({
  QB: v.number(),
  RB: v.number(),
  WR: v.number(),
  TE: v.number(),
  DST: v.number(),
  K: v.number(),
  FLEX: v.number(),
  SUPERFLEX: v.number(),
  BENCH: v.number(),
});

// Writes a freshly-fetched Yahoo roster/scoring config onto the season -
// called by resyncSeasonSettingsFromYahoo below, both right as a real draft
// starts (zero picks exist yet, so any change is unconditionally safe) and
// once Yahoo confirms "postdraft" (a last-chance catch-up if the settings
// changed after the season was originally linked/started). Confirmed live
// 2026-09-08: a commissioner dropped 2 bench spots in Yahoo's league
// settings right before the real draft opened, so the real draft only ran
// 11 rounds while this app stayed configured for 13 - no synced pick would
// ever fill those last 2 rounds, leaving the board on-the-clock forever and
// drafts.status (see status.ts) unable to ever reach "complete", which
// gates the Report Card.
//
// Also carries teScoring/sixPointPassTds (added 2026-09-09, alongside
// scoring/rosterSlots above - previously missing here the same way the
// import wizard was missing them, see YAHOO.md) - both affect draft-value
// math (convex/scoring.ts's bonusPoints), same reason a stale rosterSlots
// mattered enough to build this resync for in the first place.
//
// Refuses to shrink rosterSlots below whatever round count this draft's own
// synced picks already reach - a real Yahoo settings change should never
// retroactively invalidate picks that already happened, and this also
// guards against a transient/malformed settings read silently truncating a
// perfectly fine larger roster.
export const applyYahooSettingsResync = internalMutation({
  args: {
    draftId: v.id("drafts"),
    seasonId: v.id("seasons"),
    rosterSlots: yahooResyncRosterSlotsValidator,
    flexPositions: v.array(positionValidator),
    superflexPositions: v.array(positionValidator),
    scoring: scoringValidator,
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ changed: boolean }> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return { changed: false };

    const unchanged =
      JSON.stringify(season.rosterSlots) === JSON.stringify(args.rosterSlots) &&
      JSON.stringify(season.flexPositions) ===
        JSON.stringify(args.flexPositions) &&
      JSON.stringify(season.superflexPositions) ===
        JSON.stringify(args.superflexPositions) &&
      season.scoring === args.scoring &&
      (season.teScoring ?? "NONE") === args.teScoring &&
      (season.sixPointPassTds ?? false) === args.sixPointPassTds;
    if (unchanged) return { changed: false };

    const newTotalRounds = expandRosterSlots(args.rosterSlots).length;
    const picks = await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", args.draftId))
      .collect();
    const picksPerTeam = new Map<Id<"seasonTeams">, number>();
    for (const pick of picks) {
      picksPerTeam.set(pick.teamId, (picksPerTeam.get(pick.teamId) ?? 0) + 1);
    }
    const maxPicksForAnyTeam = Math.max(0, ...picksPerTeam.values());
    if (newTotalRounds < maxPicksForAnyTeam) {
      await upsertSyncStatus(ctx, args.draftId, {
        syncError:
          `Yahoo's real roster settings (${newTotalRounds} rounds) look ` +
          `smaller than picks already synced (${maxPicksForAnyTeam}) - ` +
          "left season settings as-is, check manually.",
        syncErrorCount: undefined,
      });
      return { changed: false };
    }

    await ctx.db.patch(args.seasonId, {
      rosterSlots: args.rosterSlots,
      flexPositions: args.flexPositions,
      superflexPositions: args.superflexPositions,
      scoring: args.scoring,
      teScoring: args.teScoring,
      sixPointPassTds: args.sixPointPassTds,
    });
    await invalidateDraftValues(ctx, args.draftId);
    await syncDraftStatus(ctx, args.draftId);
    return { changed: true };
  },
});

// Action-side counterpart to applyYahooSettingsResync above - does the
// actual Yahoo fetch (needs the access token, so can't run inside a
// mutation) and hands the mapped result to it. Best-effort: any failure
// here (network, unexpected shape) is swallowed rather than thrown, same
// degrade-gracefully contract fetchPreviousYahooSeasonPreview uses for
// prior-season keeper import - a settings-resync miss shouldn't take down
// the pick-syncing poll chain around it.
async function resyncSeasonSettingsFromYahoo(
  ctx: ActionCtx,
  draftId: Id<"drafts">,
  seasonId: Id<"seasons">,
  accessToken: string,
  yahooLeagueKey: string,
): Promise<void> {
  try {
    const settings = await fetchYahooLeagueSettings(accessToken, yahooLeagueKey);
    const mappedRoster = mapYahooRosterPositions(settings.raw);
    const scoring = mapYahooScoringSettings(settings.raw);
    const teScoring = mapYahooTeScoring(settings.raw);
    const sixPointPassTds = mapYahooSixPointPassTds(settings.raw);
    await ctx.runMutation(internal.infinidraft.yahoo.draftSync.applyYahooSettingsResync, {
      draftId,
      seasonId,
      rosterSlots: mappedRoster.rosterSlots,
      flexPositions: mappedRoster.flexPositions,
      superflexPositions: mappedRoster.superflexPositions,
      scoring,
      teScoring,
      sixPointPassTds,
    });
  } catch {
    // Leave season settings untouched - the next tick tries again.
  }
}

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

    // Yahoo never exposes the real draft order pre-draft (see YAHOO.md) -
    // linkYahooDraft only requires *some* draftOrder configured so the
    // feature can be enabled ahead of time, but Yahoo can (and typically
    // does) randomize/reveal the actual slot assignments right as the draft
    // room opens, after which the Teams panel no longer allows editing
    // draftOrder (picks are already being placed against it). So every
    // tick, once round 1's own picks have revealed a full slot-by-slot
    // order (one distinct team_key per seasonTeam, in pick order), that
    // real order overwrites whatever was configured - confirmed-live Yahoo
    // data always wins over a pre-draft guess. Harmless to keep re-deriving
    // every tick even after it's settled (identical order = no-op patch
    // avoided below), same re-derive-everything-per-tick approach the rest
    // of this poller already uses.
    let draftOrder = draft.draftOrder ?? [];
    if (mode !== "auction" && teams.length > 0) {
      const round1TeamKeysInOrder: string[] = [];
      const seenTeamKeys = new Set<string>();
      for (const pick of [...args.picks].sort((a, b) => a.pickNo - b.pickNo)) {
        if (pick.round !== 1 || !pick.teamKey || seenTeamKeys.has(pick.teamKey)) continue;
        seenTeamKeys.add(pick.teamKey);
        round1TeamKeysInOrder.push(pick.teamKey);
      }
      if (round1TeamKeysInOrder.length === teams.length) {
        const derivedOrder = round1TeamKeysInOrder
          .map((teamKey) => teamByYahooTeamKey.get(teamKey)?._id)
          .filter((id): id is Doc<"seasonTeams">["_id"] => id !== undefined);
        const changed =
          derivedOrder.length !== draftOrder.length ||
          derivedOrder.some((id, i) => id !== draftOrder[i]);
        if (derivedOrder.length === teams.length && changed) {
          await ctx.db.patch(args.draftId, { draftOrder: derivedOrder });
          draftOrder = derivedOrder;
        }
      }
    }
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
          // Draft room just opened - Yahoo only reveals real roster/scoring
          // settings (and the real draft order, handled separately in
          // applyYahooSyncTick below) once drafting is imminent/underway,
          // never before (see YAHOO.md). Zero picks exist yet at this
          // point, so any settings change here is unconditionally safe to
          // apply - this is what catches a commissioner's last-minute Yahoo
          // settings edit (e.g. dropped bench spots) before any pick ever
          // gets synced against the stale config.
          await resyncSeasonSettingsFromYahoo(
            ctx,
            args.draftId,
            draft.seasonId,
            accessToken,
            yahooLeagueKey,
          );
          await ctx.runMutation(
            internal.infinidraft.draft.lifecycle.startDraftForSyncInternal,
            { draftId: args.draftId },
          );
        } else if (draftStatus === "postdraft") {
          // Last-chance catch-up: if the draft-start resync above was never
          // reached (e.g. sync was enabled after the draft had already
          // started) or Yahoo's settings changed again mid-draft, this is
          // the final tick before applyYahooSyncTick's own postdraft check
          // disables sync below - see applyYahooSettingsResync's comment
          // for the guard against shrinking below picks that already
          // happened.
          await resyncSeasonSettingsFromYahoo(
            ctx,
            args.draftId,
            draft.seasonId,
            accessToken,
            yahooLeagueKey,
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
