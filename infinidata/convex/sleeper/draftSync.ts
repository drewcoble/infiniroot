import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { requireDraftOwner, requireRealDraft } from "../lib/access";
import { resolveDraftType } from "../draftType";
import { resolveTeamPositionInRound } from "../infinidraft/draft/pickOrder";
import { countForfeitedByRound, countRealSlotsThroughRound } from "../infinidraft/draft/pickSlots";
import {
  fetchSleeperJson,
  fetchSleeperLeagueSettings,
  sleeperPlayerIdToFpid,
  type SleeperDraft,
  type SleeperDraftPick,
} from "./league";

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

// Upserts the poll chain's heartbeat onto its own draftSyncStatus row
// (schema.ts) instead of the `drafts` document - see that table's comment
// for why: writing this every ~3s onto `drafts` used to invalidate every
// Draft Room query reading that document, which is what blew up read
// bandwidth. `.unique()` is safe here because every write site below goes
// through this same upsert, so a draft never accumulates more than one row.
async function upsertSyncStatus(
  ctx: MutationCtx,
  draftId: Id<"drafts">,
  patch: {
    lastSyncedAt?: number;
    syncError: string | undefined;
    syncErrorCount: number | undefined;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("draftSyncStatus")
    .withIndex("by_draft", (q) => q.eq("draftId", draftId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    // insert() requires the exact optional-field shape (no explicit
    // `undefined`), unlike patch() above - conditionally spread instead.
    await ctx.db.insert("draftSyncStatus", {
      draftId,
      ...(patch.lastSyncedAt !== undefined
        ? { lastSyncedAt: patch.lastSyncedAt }
        : {}),
      ...(patch.syncError !== undefined ? { syncError: patch.syncError } : {}),
      ...(patch.syncErrorCount !== undefined
        ? { syncErrorCount: patch.syncErrorCount }
        : {}),
    });
  }
}

// Resolves the real draft for a season the caller already proved ownership
// of (via internal.rosterSync.requireOwnedSeasonForSync) - actions
// can't call the QueryCtx-typed requireRealDraft directly, same reason
// convex/sleeper/league.ts's syncLeagueRoster needs
// listSeasonTeamsInternal instead of listSeasonTeams.
export const loadRealDraftForLink = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await requireRealDraft(ctx, args.seasonId);
  },
});

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
      internal.sleeper.draftSync.loadRealDraftForLink,
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
      internal.sleeper.draftSync.loadRealDraftForLink,
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

export const loadSyncStateInternal = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId);
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

// Applies one poll's worth of Sleeper picks: resolves each pick's roster_id/
// picked_by to a seasonTeams row (same join technique convex/sleeper/
// league.ts's syncLeagueRoster uses for rosters), then - for snake/linear -
// resolves round/pickInRound/overallPick via the same
// resolveTeamPositionInRound/countRealSlotsThroughRound helpers draftPick
// and addKeeper use, so a synced pick's slot always agrees with the board
// regardless of Sleeper's own raw slot numbering. Hands the fully-resolved
// subset to convex/infinidraft/draft/picks.ts's applySleeperSyncedPicks for the actual
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
      internal.infinidraft.draft.picks.applySleeperSyncedPicks,
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
      internal.sleeper.draftSync.loadSyncStateInternal,
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
        await ctx.runMutation(
          internal.infinidraft.draft.lifecycle.startDraftForSyncInternal,
          { draftId: args.draftId },
        );
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

// Scoped, cheap counterpart to the sync fields listSeasons/getSeasonPublic
// used to join off the `drafts` document itself - reads only the
// draftSyncStatus row (schema.ts) plus the auth check, so the frontend can
// subscribe to the live "last checked"/error readout without also
// resubscribing every other listSeasons-backed panel on the page to a
// value that changes every ~3 seconds. See draftSyncStatus's schema comment
// for the read-amplification bug this replaces.
export const getSyncStatus = query({
  args: { seasonId: v.id("seasons") },
  handler: async (
    ctx,
    args,
  ): Promise<{ lastSyncedAt: number | null; syncError: string | null }> => {
    const { draft } = await requireDraftOwner(ctx, args.seasonId);
    const status = await ctx.db
      .query("draftSyncStatus")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .unique();
    return {
      lastSyncedAt: status?.lastSyncedAt ?? null,
      syncError: status?.syncError ?? null,
    };
  },
});
