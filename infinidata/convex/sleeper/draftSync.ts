import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { requireDraftOwner } from "../lib/access";
import { resolveDraftType } from "../draftType";
import { resolveTeamPositionInRound } from "../infinidraft/draft/pickOrder";
import { countForfeitedByRound, countRealSlotsThroughRound } from "../infinidraft/draft/pickSlots";
import { syncDraftStatus } from "../infinidraft/draft/status";
import { upsertSyncStatus } from "../infinidraft/draft/draftSyncShared";
import { expandRosterSlots } from "../lib/rosterSlots";
import { invalidateDraftValues } from "../draftValues";
import { positionValidator } from "../positions";
import { scoringValidator, teScoringValidator } from "../scoring";
import {
  fetchSleeperJson,
  fetchSleeperLeagueSettings,
  sleeperPlayerIdToFpid,
  type SleeperDraft,
  type SleeperDraftPick,
} from "./league";
import {
  mapRosterPositions,
  mapScoringSettings,
  mapSixPointPassTds,
  mapTeScoring,
} from "./leagueSettingsMapping";

// Live sync from an in-progress Sleeper draft into this app's own
// draftPicks, for any of the three formats Sleeper supports (auction,
// snake, linear) - see schema.ts's drafts.sleeper* fields for the full
// design. Sleeper's API has no webhooks, so this is a self-rescheduling
// internalAction (ctx.scheduler.runAfter calling itself) rather than a
// cron - a cron runs on a fixed global schedule with static args and can't
// be parameterized per-draft or turned off cleanly, whereas a
// self-rescheduling chain just stops rescheduling when it's done.
//
// Once picks are flowing; a slower cadence is used pre-draft (nothing to
// fetch but the draft's own status/start_time).
const FAST_INTERVAL_MS = 3_000;
const SLOW_INTERVAL_MS = 60_000;
// How far ahead of Sleeper's scheduled start_time to auto-start the in-app
// draft, so the host doesn't have to remember to click "Start Draft".
const AUTO_START_WINDOW_MS = 10 * 60 * 1000;
// After this many consecutive failed polls, auto-disable rather than retry
// forever silently - see recordSyncError.
const MAX_CONSECUTIVE_FAILURES = 10;

// Caches Sleeper's own draft_id/start_time on the real draft doc, entirely
// independent of sleeperSyncEnabled - lets the Dashboard/Settings/Draft tab
// show a scheduled draft time as soon as a season is Sleeper-linked, well
// before the host is ready to turn on live sync (or for a league that never
// will, e.g. one still drafting manually alongside the real Sleeper draft).
export const recordSleeperDraftSchedule = internalMutation({
  args: {
    draftId: v.id("drafts"),
    sleeperDraftId: v.string(),
    scheduledAt: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, {
      sleeperDraftId: args.sleeperDraftId,
      ...(args.scheduledAt !== null
        ? { sleeperDraftScheduledAt: args.scheduledAt }
        : {}),
    });
    return null;
  },
});

// Best-effort refresh, called from the frontend on mount wherever the
// scheduled time is shown (Dashboard reads the cached value only, to avoid
// hammering Sleeper once per league on every page load) - silently no-ops
// (rather than throwing) for a season with no Sleeper link or no draft set
// up yet, since this runs passively rather than from a user-clicked button.
export const fetchSleeperDraftSchedule = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ scheduledAt: number | null }> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.sleeperLeagueId) return { scheduledAt: null };

    const draft = await ctx.runQuery(
      internal.infinidraft.draft.draftSyncShared.loadRealDraftForLink,
      { seasonId: args.seasonId },
    );

    try {
      const settings = await fetchSleeperLeagueSettings(season.sleeperLeagueId);
      if (!settings.draft_id) return { scheduledAt: null };
      const sleeperDraft = await fetchSleeperJson<SleeperDraft>(
        `/draft/${settings.draft_id}`,
      );
      const scheduledAt = sleeperDraft.start_time ?? null;
      await ctx.runMutation(
        internal.sleeper.draftSync.recordSleeperDraftSchedule,
        { draftId: draft._id, sleeperDraftId: settings.draft_id, scheduledAt },
      );
      return { scheduledAt };
    } catch {
      return { scheduledAt: null };
    }
  },
});

// Bumps sleeperSyncGeneration and flips the draft into sync-enabled state -
// the generation bump is what lets a stale poll chain (from a prior enable/
// disable/enable cycle) recognize on its next hop that it's been superseded
// and stop, instead of two chains ever polling the same draft in parallel.
export const enableSync = internalMutation({
  args: { draftId: v.id("drafts"), sleeperDraftId: v.string() },
  handler: async (ctx, args): Promise<number> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error("Draft not found.");
    const generation = (draft.sleeperSyncGeneration ?? 0) + 1;
    await ctx.db.patch(args.draftId, {
      sleeperDraftId: args.sleeperDraftId,
      sleeperSyncEnabled: true,
      sleeperSyncGeneration: generation,
    });
    await upsertSyncStatus(ctx, args.draftId, {
      syncError: undefined,
      syncErrorCount: undefined,
    });
    return generation;
  },
});

// Links this season's real draft to its Sleeper league's current live
// draft and kicks off the poll chain. Requires every seasonTeam to already
// be mapped to a Sleeper roster (Season Settings' team-mapping step) so
// picks don't start silently getting skipped mid-draft, and requires the
// Sleeper draft's own type to match this season's configured draftType
// (resolveDraftType) - a mismatch would silently write nonsense round/price
// data, so it's rejected up front instead. Snake/linear additionally
// requires the in-app Draft Order (drafts.draftOrder/reversalRounds,
// Settings' Teams panel) to already mirror Sleeper's real draft order,
// since a synced pick's round/pickInRound is computed from *our*
// configured order (resolveTeamPositionInRound below), not re-derived from
// Sleeper's own slot numbering.
export const linkSleeperDraft = action({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<{ sleeperDraftId: string }> => {
    const { season } = await ctx.runQuery(
      internal.rosterSync.requireOwnedSeasonForSync,
      { seasonId: args.seasonId },
    );
    if (!season.sleeperLeagueId) {
      throw new Error("Link a Sleeper league first.");
    }

    const draft = await ctx.runQuery(
      internal.infinidraft.draft.draftSyncShared.loadRealDraftForLink,
      { seasonId: args.seasonId },
    );

    const teams: Doc<"seasonTeams">[] = await ctx.runQuery(
      internal.seasonTeams.listSeasonTeamsInternal,
      { seasonId: args.seasonId },
    );
    if (teams.length === 0 || teams.some((t) => !t.sleeperRosterId)) {
      throw new Error(
        "Map every team to a Sleeper roster (above) before enabling live sync.",
      );
    }

    const settings = await fetchSleeperLeagueSettings(season.sleeperLeagueId);
    if (!settings.draft_id) {
      throw new Error("This Sleeper league doesn't have a draft yet.");
    }
    const sleeperDraft = await fetchSleeperJson<SleeperDraft>(
      `/draft/${settings.draft_id}`,
    );
    const mode = resolveDraftType(season, draft);
    if (sleeperDraft.type !== mode) {
      throw new Error(
        `This league is set up as ${mode}, but the Sleeper draft is ${sleeperDraft.type}. ` +
          "Fix the draft type in League Settings before enabling live sync.",
      );
    }
    if (mode !== "auction" && (!draft.draftOrder || draft.draftOrder.length === 0)) {
      throw new Error(
        "Set the draft order (Settings' Teams panel) to match Sleeper's real draft order before enabling live sync.",
      );
    }

    const generation: number = await ctx.runMutation(
      internal.sleeper.draftSync.enableSync,
      { draftId: draft._id, sleeperDraftId: settings.draft_id },
    );

    await ctx.scheduler.runAfter(
      0,
      internal.sleeper.draftSync.syncSleeperDraft,
      { draftId: draft._id, generation },
    );

    return { sleeperDraftId: settings.draft_id };
  },
});

// The chain notices this on its own next hop (loadSyncStateInternal below)
// and stops rescheduling - up to one poll interval of latency, negligible at
// the 3s fast interval, longer (up to 60s) if paused during the slow
// pre-draft watch phase.
export const disableLiveSync = mutation({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    await ctx.db.patch(draft._id, { sleeperSyncEnabled: false });
    return null;
  },
});

// Called on the slow pre-draft cadence (draft not started yet, Sleeper
// hasn't opened the auto-start window) - just a heartbeat so the UI's "last
// checked" readout still moves, and a place to clear a stale error once
// things recover.
export const recordWatchTick = internalMutation({
  args: { draftId: v.id("drafts"), generation: v.number() },
  handler: async (ctx, args): Promise<{ stopped: boolean }> => {
    const draft = await ctx.db.get(args.draftId);
    if (
      !draft ||
      !draft.sleeperSyncEnabled ||
      draft.sleeperSyncGeneration !== args.generation
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

// No-auth re-read of a season for the poll loop's per-hop settings-resync
// lookup below - same trust model as draftSyncShared's loadSyncStateInternal
// (internal/not user-facing, authorization already happened at link time).
export const loadSleeperSyncSeason = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.seasonId);
  },
});

const sleeperResyncRosterSlotsValidator = v.object({
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

// Writes a freshly-fetched Sleeper roster/scoring config onto the season -
// same feature and rationale as convex/infinidraft/yahoo/draftSync.ts's
// applyYahooSettingsResync (see that file's comment for the live incident
// that motivated it: a commissioner changing league settings between import/
// link and the real draft starting, leaving this app's roster/scoring
// config stale for the entire draft). Sleeper's `linkSleeperDraft` above
// already validates draft TYPE (auction/snake/linear) matches at link time,
// but nothing previously re-checked roster slots or scoring once linked -
// this closes that gap the same way Yahoo's version does, called by
// resyncSeasonSettingsFromSleeper below both right as the real draft starts
// (zero picks exist yet, so any change is unconditionally safe) and once
// Sleeper confirms "complete" (a last-chance catch-up).
//
// Refuses to shrink rosterSlots below whatever round count this draft's own
// synced picks already reach - a real Sleeper settings change should never
// retroactively invalidate picks that already happened, and this also
// guards against a transient/malformed settings read silently truncating a
// perfectly fine larger roster.
export const applySleeperSettingsResync = internalMutation({
  args: {
    draftId: v.id("drafts"),
    seasonId: v.id("seasons"),
    rosterSlots: sleeperResyncRosterSlotsValidator,
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
          `Sleeper's real roster settings (${newTotalRounds} rounds) look ` +
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

// Action-side counterpart to applySleeperSettingsResync above - does the
// actual Sleeper fetch and hands the mapped result to it. Best-effort: any
// failure here (network, unexpected shape) is swallowed rather than thrown,
// same degrade-gracefully contract convex/infinidraft/yahoo/draftSync.ts's
// resyncSeasonSettingsFromYahoo uses - a settings-resync miss shouldn't take
// down the pick-syncing poll chain around it.
async function resyncSeasonSettingsFromSleeper(
  ctx: ActionCtx,
  draftId: Id<"drafts">,
  seasonId: Id<"seasons">,
  sleeperLeagueId: string,
): Promise<void> {
  try {
    const settings = await fetchSleeperLeagueSettings(sleeperLeagueId);
    const mappedRoster = mapRosterPositions(settings.roster_positions ?? []);
    const scoring = mapScoringSettings(settings.scoring_settings);
    const teScoring = mapTeScoring(settings.scoring_settings);
    const sixPointPassTds = mapSixPointPassTds(settings.scoring_settings);
    await ctx.runMutation(internal.sleeper.draftSync.applySleeperSettingsResync, {
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

// Applies one poll's worth of Sleeper picks: resolves each pick's roster_id/
// picked_by to a seasonTeams row (same join technique convex/sleeper/
// league.ts's syncLeagueRoster uses for rosters), then - for snake/linear -
// resolves round/pickInRound/overallPick via the same
// resolveTeamPositionInRound/countRealSlotsThroughRound helpers draftPick
// and addKeeper use, so a synced pick's slot always agrees with the board
// regardless of Sleeper's own raw slot numbering. Hands the fully-resolved
// subset to convex/infinidraft/draft/picks.ts's applySyncedDraftPicks for the actual
// draftPicks writes. A pick with no fpid/price (auction) or no resolvable
// round/position (snake/linear), or no mapped team, is skipped rather than
// thrown, so one bad mapping doesn't halt the rest of the draft - the
// skipped count surfaces to the host via draftSyncStatus.syncError.
export const applySleeperSyncTick = internalMutation({
  args: {
    draftId: v.id("drafts"),
    generation: v.number(),
    sleeperStatus: v.string(),
    picks: v.array(
      v.object({
        fpid: v.union(v.number(), v.null()),
        price: v.union(v.number(), v.null()),
        round: v.union(v.number(), v.null()),
        pickNo: v.number(),
        rosterId: v.union(v.string(), v.null()),
        pickedBy: v.union(v.string(), v.null()),
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
      !draft.sleeperSyncEnabled ||
      draft.sleeperSyncGeneration !== args.generation
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
    const teamByRosterId = new Map(
      teams
        .filter((t) => t.sleeperRosterId)
        .map((t) => [t.sleeperRosterId as string, t]),
    );
    const teamByOwnerId = new Map(
      teams
        .filter((t) => t.sleeperOwnerId)
        .map((t) => [t.sleeperOwnerId as string, t]),
    );

    // Only needed for snake/linear - computed once per tick rather than
    // per-pick, same as draftPick/addKeeper's own per-mutation computation.
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
      const team =
        (pick.rosterId ? teamByRosterId.get(pick.rosterId) : undefined) ??
        (pick.pickedBy ? teamByOwnerId.get(pick.pickedBy) : undefined);
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
    // sleeperSyncEnabled lives on `drafts` itself (rather than
    // draftSyncStatus) since it gates the poll chain's own continuation
    // below - but it's only ever flipped here once, when Sleeper reports
    // the draft complete, not on every tick, so this doesn't reintroduce
    // the per-tick `drafts` invalidation the heartbeat split above avoids.
    if (args.sleeperStatus === "complete") {
      await ctx.db.patch(args.draftId, { sleeperSyncEnabled: false });
    }

    return { stopped: false, applied, skipped };
  },
});

// On a fetch/apply failure: record the error, back off (simple linear
// increase capped at 60s - Sleeper doesn't document a Retry-After contract,
// so a full exponential-backoff scheme would be over-engineering), and
// auto-disable after MAX_CONSECUTIVE_FAILURES so a persistently bad draft id
// or a Sleeper outage doesn't retry forever unattended. A single transient
// failure should not kill the chain - only enough of them in a row.
export const recordSyncError = internalMutation({
  args: { draftId: v.id("drafts"), generation: v.number(), message: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ stopped: boolean; nextDelayMs: number }> => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.sleeperSyncGeneration !== args.generation) {
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
      await ctx.db.patch(args.draftId, { sleeperSyncEnabled: false });
    }
    return {
      stopped: disabled,
      nextDelayMs: Math.min(
        FAST_INTERVAL_MS + errorCount * FAST_INTERVAL_MS,
        60_000,
      ),
    };
  },
});

// The poll loop itself. Each hop: reload state (stop if disabled/superseded/
// unlinked), fetch the Sleeper draft's status/start_time, auto-start the
// in-app draft once within the auto-start window (or if Sleeper already
// shows it's drafting), fetch picks, apply new ones, then reschedule itself
// - fast while picks might be flowing, slow while just watching for the
// start window, or not at all once stopped/complete/disabled.
export const syncSleeperDraft = internalAction({
  args: { draftId: v.id("drafts"), generation: v.number() },
  handler: async (ctx, args): Promise<null> => {
    const draft = await ctx.runQuery(
      internal.infinidraft.draft.draftSyncShared.loadSyncStateInternal,
      { draftId: args.draftId },
    );
    if (
      !draft ||
      !draft.sleeperSyncEnabled ||
      draft.sleeperSyncGeneration !== args.generation ||
      !draft.sleeperDraftId
    ) {
      return null;
    }

    try {
      const sleeperDraft = await fetchSleeperJson<SleeperDraft>(
        `/draft/${draft.sleeperDraftId}`,
      );

      if (draft.startedAt === undefined) {
        const withinWindow =
          sleeperDraft.start_time !== undefined &&
          Date.now() >= sleeperDraft.start_time - AUTO_START_WINDOW_MS;
        if (!withinWindow && sleeperDraft.status === "pre_draft") {
          const tick = await ctx.runMutation(
            internal.sleeper.draftSync.recordWatchTick,
            { draftId: args.draftId, generation: args.generation },
          );
          if (!tick.stopped) {
            await ctx.scheduler.runAfter(
              SLOW_INTERVAL_MS,
              internal.sleeper.draftSync.syncSleeperDraft,
              args,
            );
          }
          return null;
        }
        // Draft room just opened - zero picks exist yet at this point, so
        // any settings change here is unconditionally safe to apply. This
        // is what catches a commissioner's last-minute Sleeper settings
        // edit (roster slots, scoring) before any pick ever gets synced
        // against a stale config - see applySleeperSettingsResync's comment.
        const seasonForResync = await ctx.runQuery(
          internal.sleeper.draftSync.loadSleeperSyncSeason,
          { seasonId: draft.seasonId },
        );
        if (seasonForResync?.sleeperLeagueId) {
          await resyncSeasonSettingsFromSleeper(
            ctx,
            args.draftId,
            draft.seasonId,
            seasonForResync.sleeperLeagueId,
          );
        }
        await ctx.runMutation(
          internal.infinidraft.draft.lifecycle.startDraftForSyncInternal,
          { draftId: args.draftId },
        );
      } else if (sleeperDraft.status === "complete") {
        // Last-chance catch-up: if the draft-start resync above was never
        // reached (e.g. sync was enabled after the draft had already
        // started) or Sleeper's settings changed again mid-draft, this is
        // the final tick before applySleeperSyncTick's own complete check
        // disables sync below - see applySleeperSettingsResync's comment
        // for the guard against shrinking below picks that already
        // happened.
        const seasonForResync = await ctx.runQuery(
          internal.sleeper.draftSync.loadSleeperSyncSeason,
          { seasonId: draft.seasonId },
        );
        if (seasonForResync?.sleeperLeagueId) {
          await resyncSeasonSettingsFromSleeper(
            ctx,
            args.draftId,
            draft.seasonId,
            seasonForResync.sleeperLeagueId,
          );
        }
      }

      const sleeperPicks = await fetchSleeperJson<SleeperDraftPick[]>(
        `/draft/${draft.sleeperDraftId}/picks`,
      );

      const result = await ctx.runMutation(
        internal.sleeper.draftSync.applySleeperSyncTick,
        {
          draftId: args.draftId,
          generation: args.generation,
          sleeperStatus: sleeperDraft.status,
          picks: sleeperPicks.map((pick) => {
            const amount = Number(pick.metadata?.amount);
            return {
              fpid: sleeperPlayerIdToFpid(pick.player_id),
              price: Number.isFinite(amount) ? Math.round(amount) : null,
              round: pick.round ?? null,
              pickNo: pick.pick_no,
              rosterId:
                pick.roster_id !== null && pick.roster_id !== undefined
                  ? String(pick.roster_id)
                  : null,
              pickedBy: pick.picked_by ?? null,
            };
          }),
        },
      );

      if (!result.stopped && sleeperDraft.status !== "complete") {
        await ctx.scheduler.runAfter(
          FAST_INTERVAL_MS,
          internal.sleeper.draftSync.syncSleeperDraft,
          args,
        );
      }
    } catch (err) {
      const outcome = await ctx.runMutation(
        internal.sleeper.draftSync.recordSyncError,
        {
          draftId: args.draftId,
          generation: args.generation,
          message: err instanceof Error ? err.message : String(err),
        },
      );
      if (!outcome.stopped) {
        await ctx.scheduler.runAfter(
          outcome.nextDelayMs,
          internal.sleeper.draftSync.syncSleeperDraft,
          args,
        );
      }
    }
    return null;
  },
});
