import { v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

export const getInjuries = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("injuries").collect();
  },
});

// Every field Sleeper itself supplies - the only fields compared to decide
// whether a row changed. updatedAt/fetchedAt are ours, and irWeeks/
// probabilityOfPlaying are derived judgments (see the injuries schema
// comment), so none of those can count as "Sleeper says something new".
const SOURCE_FIELDS = [
  "status",
  "statusShort",
  "injuryType",
  "comment",
  "practice1",
  "practice2",
  "practice3",
  "practiceReportInjuryType",
] as const;

type SnapshotKind = NonNullable<Doc<"injurySnapshots">["kind"]>;

// Spelled out (rather than inferred) so callers running this via
// ctx.runMutation can annotate their own return type without a circular
// inference through the generated `internal` API.
export interface ApplyInjuryFetchResult {
  listed: number;
  inserted: number;
  updated: number;
  removed: number;
  removalSkipped: boolean;
  snapshots: Record<SnapshotKind, number>;
  changedFpids: number[];
  carriedForwardFpids: number[];
}

// Removal guard: if a fetch comes back with fewer than half as many injured
// players as are currently stored, assume a partial/bad Sleeper response
// rather than a mass recovery - deleting (and writing "cleared" snapshots
// for) most of the table would falsely end every one of those injuries'
// history, then re-record them all as brand-new injuries on the next good
// fetch. Only applied once the table is big enough for the ratio to mean
// something (early preseason can legitimately have a handful of rows).
const REMOVAL_GUARD_MIN_EXISTING = 20;
const REMOVAL_GUARD_MIN_KEPT_FRACTION = 0.5;

async function appendSnapshot(
  ctx: MutationCtx,
  args: { season: string; week: string; now: number },
  fpid: number,
  fields: Pick<Doc<"injuries">, "status" | "statusShort" | "injuryType" | "comment">,
  kind: SnapshotKind,
): Promise<void> {
  await ctx.db.insert("injurySnapshots", {
    fpid,
    season: args.season,
    week: args.week,
    status: fields.status,
    statusShort: fields.statusShort,
    injuryType: fields.injuryType,
    comment: fields.comment,
    fetchedAt: args.now,
    kind,
  });
}

// Applies one Sleeper injury fetch (convex/sleeper/injuries.ts, every 15
// minutes) to both the live `injuries` table and the `injurySnapshots`
// history, in one transaction so the two can never disagree. A run where
// nothing changed writes nothing at all - see the injuries schema comment
// for why that matters. Per row:
// - unchanged Sleeper fields: skipped entirely
// - new or changed: inserted/patched, derived judgments reset, and a
//   "change" snapshot appended if status/injuryType moved (a note-only edit
//   updates the row but isn't a status change)
// - no longer listed: deleted, with a "cleared" snapshot (unless the
//   removal guard above trips)
// Plus, once per new week: a "carryForward" snapshot for every player still
// listed who doesn't already have a row for that week.
// changedFpids/carriedForwardFpids are returned for whatever needs to react
// to them (e.g. re-deriving judgments) without re-diffing the table.
export const applyInjuryFetch = internalMutation({
  args: {
    season: v.string(),
    week: v.string(),
    rows: v.array(
      v.object({
        fpid: v.number(),
        status: v.string(),
        statusShort: v.string(),
        injuryType: v.string(),
        comment: v.string(),
        practice1: v.union(v.string(), v.null()),
        practice2: v.union(v.string(), v.null()),
        practice3: v.union(v.string(), v.null()),
        practiceReportInjuryType: v.union(v.string(), v.null()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<ApplyInjuryFetchResult> => {
    const now = Date.now();
    const snapshotArgs = { season: args.season, week: args.week, now };
    const snapshots: Record<SnapshotKind, number> = {
      change: 0,
      carryForward: 0,
      cleared: 0,
    };

    const existing = await ctx.db.query("injuries").collect();
    const existingByFpid = new Map(existing.map((row) => [row.fpid, row]));
    const listed = new Map<number, (typeof args.rows)[number]>();
    const changedFpids: number[] = [];
    let inserted = 0;
    let updated = 0;

    for (const row of args.rows) {
      if (listed.has(row.fpid)) continue;
      listed.set(row.fpid, row);

      const { fpid, ...source } = row;
      const match = existingByFpid.get(fpid);
      if (match && SOURCE_FIELDS.every((field) => match[field] === source[field])) {
        continue;
      }

      if (match) {
        await ctx.db.patch(match._id, {
          ...source,
          irWeeks: [],
          probabilityOfPlaying: null,
          updatedAt: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("injuries", {
          fpid,
          ...source,
          irWeeks: [],
          probabilityOfPlaying: null,
          updatedAt: now,
          fetchedAt: now,
        });
        inserted += 1;
      }
      changedFpids.push(fpid);

      const statusChanged =
        !match ||
        match.status !== source.status ||
        match.statusShort !== source.statusShort ||
        match.injuryType !== source.injuryType;
      if (statusChanged) {
        await appendSnapshot(ctx, snapshotArgs, fpid, source, "change");
        snapshots.change += 1;
      }
    }

    const toRemove = existing.filter((row) => !listed.has(row.fpid));
    const removalSkipped =
      existing.length >= REMOVAL_GUARD_MIN_EXISTING &&
      listed.size < existing.length * REMOVAL_GUARD_MIN_KEPT_FRACTION;
    if (removalSkipped) {
      console.warn(
        `applyInjuryFetch: fetch listed ${listed.size} injured players vs ` +
          `${existing.length} stored - skipping ${toRemove.length} removals ` +
          `and this run's week carry-forward as a likely partial response`,
      );
    } else {
      for (const row of toRemove) {
        await ctx.db.delete(row._id);
        await appendSnapshot(
          ctx,
          snapshotArgs,
          row.fpid,
          { status: "Active", statusShort: "", injuryType: "", comment: "" },
          "cleared",
        );
        snapshots.cleared += 1;
      }
    }

    // Week rollover - skipped along with removals on a suspect fetch, and
    // the sync state left unadvanced, so the next good run does it instead
    // of this one carrying forward only a partial list.
    const carriedForwardFpids: number[] = [];
    const syncState = await ctx.db.query("injurySyncState").first();
    const isNewWeek =
      !syncState || syncState.season !== args.season || syncState.week !== args.week;
    if (isNewWeek && !removalSkipped) {
      for (const [fpid, row] of listed) {
        const latest = await ctx.db
          .query("injurySnapshots")
          .withIndex("by_fpid", (q) => q.eq("fpid", fpid))
          .order("desc")
          .first();
        // Already has this week's row - e.g. a "change" appended above.
        if (latest && latest.season === args.season && latest.week === args.week) {
          continue;
        }
        await appendSnapshot(ctx, snapshotArgs, fpid, row, "carryForward");
        snapshots.carryForward += 1;
        carriedForwardFpids.push(fpid);
      }

      const state = { season: args.season, week: args.week, updatedAt: now };
      if (syncState) {
        await ctx.db.patch(syncState._id, state);
      } else {
        await ctx.db.insert("injurySyncState", state);
      }
    }

    return {
      listed: listed.size,
      inserted,
      updated,
      removed: removalSkipped ? 0 : toRemove.length,
      removalSkipped,
      snapshots,
      changedFpids,
      carriedForwardFpids,
    };
  },
});
