import { v, type Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { POSITIONS, positionValidator } from "../positions";
import { scoringConfigFromSeason, scoringValidator, teScoringValidator } from "../scoring";

type Position = (typeof POSITIONS)[number];

// Every season setting the rest-of-season board (convex/rosVor.ts) is
// computed from, and nothing else - two leagues with the same fields here
// get an identical board, so they share one leagueShapes row and one set of
// rosVorShapeSnapshots rows instead of each computing and storing its own.
// BENCH is deliberately left out: replacement level only counts starter
// demand (see lib/playerValue.ts's computeReplacementLevels), so bench depth
// never changes the board and keying on it would only split shapes that are
// really the same.
export const shapeRosterSlotsValidator = v.object({
  QB: v.number(),
  RB: v.number(),
  WR: v.number(),
  TE: v.number(),
  DST: v.number(),
  K: v.number(),
  FLEX: v.number(),
  SUPERFLEX: v.number(),
});

export const leagueShapeFieldsValidator = v.object({
  scoring: scoringValidator,
  teScoring: teScoringValidator,
  sixPointPassTds: v.boolean(),
  teamCount: v.number(),
  rosterSlots: shapeRosterSlotsValidator,
  flexPositions: v.array(positionValidator),
  superflexPositions: v.array(positionValidator),
});
export type LeagueShapeFields = Infer<typeof leagueShapeFieldsValidator>;

// Canonical order (POSITIONS order, duplicates dropped) so two leagues that
// list the same flex positions differently still land on the same shape.
function canonicalPositions(positions: Position[]): Position[] {
  const set = new Set(positions);
  return POSITIONS.filter((pos) => set.has(pos));
}

// A season's shape fields plus the deterministic string they're looked up
// by (leagueShapes.by_key). Defaults (teScoring "NONE", no 6pt passing TDs)
// are filled in via scoringConfigFromSeason so an absent field and its
// explicit default produce the same key.
export function leagueShapeOf(season: Doc<"seasons">): { key: string; fields: LeagueShapeFields } {
  const scoringConfig = scoringConfigFromSeason(season);
  const slots = season.rosterSlots;
  const fields: LeagueShapeFields = {
    scoring: scoringConfig.scoring,
    teScoring: scoringConfig.teScoring,
    sixPointPassTds: scoringConfig.sixPointPassTds,
    teamCount: season.teamCount,
    rosterSlots: {
      QB: slots.QB,
      RB: slots.RB,
      WR: slots.WR,
      TE: slots.TE,
      DST: slots.DST,
      K: slots.K,
      FLEX: slots.FLEX,
      SUPERFLEX: slots.SUPERFLEX,
    },
    flexPositions: canonicalPositions(season.flexPositions),
    superflexPositions: canonicalPositions(season.superflexPositions),
  };
  return { key: leagueShapeKey(fields), fields };
}

// Built field by field (not JSON.stringify(fields)) so the key never
// depends on property order in whatever object was passed in.
export function leagueShapeKey(fields: LeagueShapeFields): string {
  const slots = fields.rosterSlots;
  return [
    fields.scoring,
    fields.teScoring,
    fields.sixPointPassTds ? "6pt" : "4pt",
    `${fields.teamCount}t`,
    `QB${slots.QB}.RB${slots.RB}.WR${slots.WR}.TE${slots.TE}.DST${slots.DST}.K${slots.K}`,
    `FLEX${slots.FLEX}:${canonicalPositions(fields.flexPositions).join("/")}`,
    `SF${slots.SUPERFLEX}:${canonicalPositions(fields.superflexPositions).join("/")}`,
  ].join("|");
}

export async function findLeagueShapeId(ctx: QueryCtx, key: string): Promise<Id<"leagueShapes"> | null> {
  const shape = await ctx.db
    .query("leagueShapes")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return shape?._id ?? null;
}

export async function ensureLeagueShapeId(ctx: MutationCtx, fields: LeagueShapeFields): Promise<Id<"leagueShapes">> {
  const key = leagueShapeKey(fields);
  const existing = await findLeagueShapeId(ctx, key);
  if (existing) return existing;
  return await ctx.db.insert("leagueShapes", { key, ...fields, createdAt: Date.now() });
}

// One season's board rows for a week, read through its current shape - the
// shared read path for every rosVorShapeSnapshots consumer (convex/rosVor.ts,
// lib/faab.ts, infinileague/auction/players.ts). A season whose shape has
// no board yet just gets [] (rosVor.ts's ensureSeasonRosVor fills it in).
// Uses the season's CURRENT shape for every week, past ones included - a
// mid-season settings change shows the new shape's history rather than
// what the league actually had then, a deliberate simplification.
export async function loadSeasonRosVorRows(
  ctx: QueryCtx,
  season: Doc<"seasons">,
  week: string,
): Promise<Doc<"rosVorShapeSnapshots">[]> {
  const shapeId = await findLeagueShapeId(ctx, leagueShapeOf(season).key);
  if (!shapeId) return [];
  return await ctx.db
    .query("rosVorShapeSnapshots")
    .withIndex("by_shape_week_fpid", (q) => q.eq("shapeId", shapeId).eq("week", week))
    .collect();
}
