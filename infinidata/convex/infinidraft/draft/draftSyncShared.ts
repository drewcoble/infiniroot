import { v } from "convex/values";
import {
  internalQuery,
  query,
  type MutationCtx,
} from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { requireDraftOwner, requireRealDraft } from "../../lib/access";

// Shared by both convex/sleeper/draftSync.ts and convex/infinidraft/yahoo/
// draftSync.ts - the poll-chain plumbing below has nothing provider-specific
// in it (only each provider's own tick/error functions do, which stay
// separate). Extracted here rather than duplicated per provider since a
// season only ever has one linked provider at a time, so there's exactly one
// "which provider is syncing this draft" answer for the UI to read
// regardless of which poller is actually running.

// Upserts the poll chain's heartbeat onto its own draftSyncStatus row
// (schema.ts) instead of the `drafts` document - see that table's comment
// for why: writing this every few seconds onto `drafts` used to invalidate
// every Draft Room query reading that document, which is what blew up read
// bandwidth. `.unique()` is safe here because every write site goes through
// this same upsert, so a draft never accumulates more than one row -
// including across a provider switch (disconnect Sleeper, link Yahoo later),
// since the row is keyed by draftId, not by provider.
export async function upsertSyncStatus(
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
// of (via internal.rosterSync.requireOwnedSeasonForSync) - actions can't
// call the QueryCtx-typed requireRealDraft directly, same reason
// convex/sleeper/league.ts's syncLeagueRoster needs listSeasonTeamsInternal
// instead of listSeasonTeams. Used by both providers' link actions.
export const loadRealDraftForLink = internalQuery({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args) => {
    return await requireRealDraft(ctx, args.seasonId);
  },
});

// Fresh re-read of the draft doc each poll hop, for both providers' guard
// checks (disabled/superseded generation/missing draft).
export const loadSyncStateInternal = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId);
  },
});

// Scoped, cheap counterpart to the sync fields listSeasons/getSeasonPublic
// used to join off the `drafts` document itself - reads only the
// draftSyncStatus row (schema.ts) plus the auth check, so the frontend can
// subscribe to the live "last checked"/error readout without also
// resubscribing every other listSeasons-backed panel on the page to a value
// that changes every few seconds. See draftSyncStatus's schema comment for
// the read-amplification bug this replaces. Provider-agnostic: the caller
// already knows (via drafts.sleeperSyncEnabled/yahooSyncEnabled) which
// provider is active, if any - this just reports the shared heartbeat.
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
