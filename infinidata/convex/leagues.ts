import { v } from "convex/values";
import {
  mutation,
  query,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id, Doc } from "./_generated/dataModel";
import { positionValidator } from "./positions";
import {
  scoringValidator,
  teScoringValidator,
  scoringConfigFromSeason,
} from "./scoring";
import { draftTypeValidator } from "./draftType";
import {
  invalidateDraftValues,
  refreshDraftValuesForLeague,
} from "./draftValues";
import { ensureValueGapsCached } from "./valueGaps";
import {
  requireSeasonOwner,
  requireRealDraft,
  requireDraftNotStarted,
} from "./lib/access";
import { insertSeasonTeams } from "./lib/seasonTeams";
import {
  countFreeLeagueGrantsForYear,
  FREE_LEAGUES_PER_YEAR,
  hasProAccess,
} from "./lib/entitlements";

// Mirrors src/constants/general.ts's WEEK - the single season-long
// draft-prep dataset every Draft Room query reads (not a real NFL week). See
// convex/infinidraft/draft/tiers.ts for why convex/ duplicates rather than imports
// frontend constants.
const DRAFT_PREP_WEEK = "0";

const rosterSlotsValidator = v.object({
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

export interface SeasonWithLeagueName extends Doc<"seasons"> {
  name: string;
  // The season's one real draft's status (see convex/infinidraft/draft/status.ts's
  // syncDraftStatus, which keeps this in sync with actual pick count).
  // Defaults to "pre_draft" in the never-expected case a season's real
  // draft is missing, rather than throwing - this powers the dashboard
  // league grid (src/routes/index.tsx), which needs every league to render
  // even if one row is in a bad state.
  draftStatus: "pre_draft" | "in_progress" | "complete";
  // Live-sync-from-Sleeper fields, joined from the same real draft doc (see
  // schema.ts's drafts.sleeper* fields and convex/sleeper/draftSync.ts) -
  // lets SeasonSettingsTab and the Draft Room read sync state off the same
  // `settings` query they already subscribe to, instead of a second query.
  // Deliberately excludes sleeperLastSyncedAt/sleeperSyncError: those are
  // rewritten every ~3s during a live sync and used to live on this same
  // `drafts` doc, which meant every query here (and everything downstream
  // of this list, which is nearly every page in the app) got invalidated on
  // that cadence. They now live in the draftSyncStatus table instead - read
  // them via convex/sleeper/draftSync.ts's getSyncStatus, scoped to one
  // season, so only the panel that actually shows them resubscribes that
  // often. See draftSyncStatus's schema.ts comment for the full story.
  sleeperDraftId?: string;
  sleeperDraftScheduledAt?: number;
  sleeperSyncEnabled?: boolean;
}

// Every season across every league this user owns, each carrying its
// league's display name - what the app calls "a league" in the UI (the
// picker, route params, etc) is really one season at a time, since a
// league's durable identity (leagues) has no format/roster fields of its
// own to display.
export const listSeasons = query({
  args: {},
  handler: async (ctx): Promise<SeasonWithLeagueName[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const leagues = await ctx.db
      .query("leagues")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const result: SeasonWithLeagueName[] = [];
    for (const league of leagues) {
      const seasons = await ctx.db
        .query("seasons")
        .withIndex("by_league", (q) => q.eq("leagueId", league._id))
        .collect();
      for (const season of seasons) {
        const draft = await ctx.db
          .query("drafts")
          .withIndex("by_season_kind", (q) =>
            q.eq("seasonId", season._id).eq("kind", "real"),
          )
          .first();
        result.push({
          ...season,
          name: league.name,
          draftStatus: draft?.status ?? "pre_draft",
          ...(draft?.sleeperDraftId !== undefined
            ? { sleeperDraftId: draft.sleeperDraftId }
            : {}),
          ...(draft?.sleeperDraftScheduledAt !== undefined
            ? { sleeperDraftScheduledAt: draft.sleeperDraftScheduledAt }
            : {}),
          ...(draft?.sleeperSyncEnabled !== undefined
            ? { sleeperSyncEnabled: draft.sleeperSyncEnabled }
            : {}),
        });
      }
    }
    return result;
  },
});

// infinileague-facing counterpart to listSeasons - identical shape, but
// filtered to seasons actually linked to a real external league (Sleeper or
// Yahoo). infinileague's whole feature set (waiver/FAAB/trade recommendations
// off real roster data) is meaningless for a season the user built from
// scratch here in infinidraft - there's no external roster to sync, and
// infinileague must never show one of those "custom" leagues at all (see
// infinidraft/INFINILEAGUE.md). Gated on "linked to any provider" rather than
// "linked to Sleeper" specifically - Yahoo is just not connectable yet
// (pending API access), not excluded on purpose, so a Yahoo-linked season
// should start appearing here automatically once that lands, with no change
// needed to this query.
export const listLinkedSeasons = query({
  args: {},
  handler: async (ctx): Promise<SeasonWithLeagueName[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const leagues = await ctx.db
      .query("leagues")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const result: SeasonWithLeagueName[] = [];
    for (const league of leagues) {
      const seasons = await ctx.db
        .query("seasons")
        .withIndex("by_league", (q) => q.eq("leagueId", league._id))
        .collect();
      for (const season of seasons) {
        if (
          season.sleeperLeagueId === undefined &&
          season.yahooLeagueKey === undefined
        ) {
          continue;
        }
        const draft = await ctx.db
          .query("drafts")
          .withIndex("by_season_kind", (q) =>
            q.eq("seasonId", season._id).eq("kind", "real"),
          )
          .first();
        result.push({
          ...season,
          name: league.name,
          draftStatus: draft?.status ?? "pre_draft",
          ...(draft?.sleeperDraftId !== undefined
            ? { sleeperDraftId: draft.sleeperDraftId }
            : {}),
          ...(draft?.sleeperDraftScheduledAt !== undefined
            ? { sleeperDraftScheduledAt: draft.sleeperDraftScheduledAt }
            : {}),
          ...(draft?.sleeperSyncEnabled !== undefined
            ? { sleeperSyncEnabled: draft.sleeperSyncEnabled }
            : {}),
        });
      }
    }
    return result;
  },
});

// Read-only, no-ownership-check counterpart to listSeasons for a single
// season - powers the TV board (src/pages/DraftBoard/DraftBoard.tsx), which
// is meant to be viewable by anyone with the link (e.g. a draft-night TV),
// not just the league's owner. The seasonId itself (an unguessable Convex
// id) is what gates access, same as any other "share this link" pattern.
export const getSeasonPublic = query({
  args: { seasonId: v.id("seasons") },
  handler: async (ctx, args): Promise<SeasonWithLeagueName | null> => {
    const season = await ctx.db.get(args.seasonId);
    if (!season) return null;
    const league = await ctx.db.get(season.leagueId);
    if (!league) return null;
    const draft = await ctx.db
      .query("drafts")
      .withIndex("by_season_kind", (q) =>
        q.eq("seasonId", season._id).eq("kind", "real"),
      )
      .first();
    return {
      ...season,
      name: league.name,
      draftStatus: draft?.status ?? "pre_draft",
      ...(draft?.sleeperDraftId !== undefined
        ? { sleeperDraftId: draft.sleeperDraftId }
        : {}),
      ...(draft?.sleeperDraftScheduledAt !== undefined
        ? { sleeperDraftScheduledAt: draft.sleeperDraftScheduledAt }
        : {}),
      ...(draft?.sleeperSyncEnabled !== undefined
        ? { sleeperSyncEnabled: draft.sleeperSyncEnabled }
        : {}),
    };
  },
});

// Every season across every owner, no auth scoping - only for
// fetchAllData's daily draftValues cache refresh (convex/fetchAllData.ts),
// which runs as a super-admin action with no signed-in "owner" of its own.
export const listAllSeasons = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("seasons").collect();
  },
});

// Creates a league, its first season, and that season's one real draft, all
// atomically - the UI still presents this as "create a league," but under
// the split model that's three rows now, not one.
export const createLeague = mutation({
  args: {
    name: v.string(),
    teamCount: v.number(),
    // Absent means "auction" (see draftType.ts's resolveDraftType) - not yet
    // sent by any current frontend caller (SettingsForm.tsx still only ever
    // creates auction leagues), so every existing creation flow keeps
    // working unchanged. See SNAKE_DRAFT.md §4 for the eventual UI wiring.
    draftType: v.optional(draftTypeValidator),
    salaryCap: v.number(),
    scoring: scoringValidator,
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
    rosterSlots: rosterSlotsValidator,
    flexPositions: v.array(positionValidator),
    superflexPositions: v.array(positionValidator),
    // Opt in to keepers at creation time instead of only via the separate
    // setUseKeepers mutation after the fact - defaults to false (same as
    // before this existed). Pro-gated the same way setUseKeepers is below.
    useKeepers: v.optional(v.boolean()),
    // Set when this league is created via the "Import from Sleeper" wizard
    // (see convex/sleeper/league.ts's previewSleeperImport) - the league is
    // linked from creation, so it never needs the separate Season Settings
    // linking step Part 3 built for leagues that started out unlinked.
    sleeperLeagueId: v.optional(v.string()),
    // Yahoo equivalent, set by the "Import from Yahoo" wizard (see
    // convex/infinidraft/yahoo/league.ts's previewYahooImport).
    yahooLeagueKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("You must be signed in.");
    }
    const now = Date.now();
    const thisSeason = String(new Date().getFullYear());
    const isPro = await hasProAccess(ctx, userId);
    const freeLeaguesUsed = await countFreeLeagueGrantsForYear(
      ctx,
      userId,
      thisSeason,
    );
    if (!isPro && freeLeaguesUsed >= FREE_LEAGUES_PER_YEAR) {
      throw new Error(
        `Free plan includes ${FREE_LEAGUES_PER_YEAR} leagues per year, and ` +
          `you've already created ${freeLeaguesUsed} for ${thisSeason}. ` +
          "Upgrade to Pro for more, or come back next year.",
      );
    }
    if (args.useKeepers && !isPro) {
      throw new Error("Keepers is a Pro feature. Upgrade to enable it.");
    }

    const {
      name,
      sleeperLeagueId,
      yahooLeagueKey,
      useKeepers,
      ...seasonFields
    } = args;

    const leagueId = await ctx.db.insert("leagues", {
      ownerId: userId,
      name,
      createdAt: now,
    });

    const seasonId = await ctx.db.insert("seasons", {
      leagueId,
      year: thisSeason,
      ...seasonFields,
      // Keepers is a Pro feature (see setUseKeepers) and opt-in now - new
      // leagues start with it explicitly off rather than relying on
      // "absent means true" (which stays true for every league created
      // before this, so existing leagues that rely on it keep working).
      useKeepers: useKeepers ?? false,
      ...(sleeperLeagueId ? { sleeperLeagueId } : {}),
      ...(yahooLeagueKey ? { yahooLeagueKey } : {}),
      createdAt: now,
    });

    const draftId = await ctx.db.insert("drafts", {
      seasonId,
      kind: "real",
      name,
      status: "pre_draft",
      createdAt: now,
    });

    // Seed default "Team 1".."Team N" rows immediately so every tab has
    // content right after creation instead of gating on a separate "Save
    // Teams" step. Skipped for the Sleeper/Yahoo import wizards (they pass
    // sleeperLeagueId/yahooLeagueKey and call initializeSeasonTeams
    // themselves afterward with the real imported team names/links -
    // calling it twice would throw "Teams have already been set up").
    if (!sleeperLeagueId && !yahooLeagueKey) {
      await insertSeasonTeams(ctx, {
        seasonId,
        draftId,
        draftType: seasonFields.draftType ?? "auction",
        selfName: "Team 1",
        opponentNames: Array.from(
          { length: seasonFields.teamCount - 1 },
          (_, i) => `Team ${i + 2}`,
        ),
      });
    }

    // Record the free-tier grant only once creation actually succeeds, and
    // only for free users - a Pro user creating a league never consumes a
    // year's free slot, so downgrading later still starts fresh.
    if (!isPro) {
      await ctx.db.insert("freeLeagueGrants", {
        userId,
        year: thisSeason,
        createdAt: now,
      });
    }

    // Seed this league's draftValues cache (and valueGaps, if this scoring
    // format hasn't been seeded by another league yet) immediately, rather
    // than leaving it empty until the next daily cron run - an empty cache
    // forces every Draft Room subscription onto the expensive live-compute
    // path (see convex/draftValues.ts / convex/valueGaps.ts cache comments).
    await refreshDraftValuesForLeague(ctx, {
      draftId,
      week: DRAFT_PREP_WEEK,
      scoringConfig: scoringConfigFromSeason(args),
    });
    await ensureValueGapsCached(ctx, {
      week: DRAFT_PREP_WEEK,
      scoringConfig: scoringConfigFromSeason(args),
      lastSeason: String(Number(thisSeason) - 1),
    });

    return seasonId;
  },
});

export const updateSeason = mutation({
  args: {
    id: v.id("seasons"),
    name: v.string(),
    teamCount: v.number(),
    salaryCap: v.number(),
    scoring: scoringValidator,
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
    rosterSlots: rosterSlotsValidator,
    flexPositions: v.array(positionValidator),
    superflexPositions: v.array(positionValidator),
  },
  handler: async (ctx, args) => {
    const { id, name, ...fields } = args;
    const { season, league } = await requireSeasonOwner(ctx, id);
    const draft = await requireRealDraft(ctx, id);

    // Once teams exist, teamCount can only change via convex/infinidraft/draft/teams.ts's
    // removeSeasonTeam (or a future add-team mutation), both of which keep
    // this field in lockstep with the actual seasonTeams rows - editing it
    // straight from League Settings used to silently desync the two (e.g.
    // shrinking a 12-team league to 10 here left all 12 real teams in place,
    // with nothing in the UI able to remove the extra two).
    const existingTeams = await ctx.db
      .query("seasonTeams")
      .withIndex("by_season", (q) => q.eq("seasonId", id))
      .collect();
    if (existingTeams.length > 0 && fields.teamCount !== existingTeams.length) {
      throw new Error(
        `This league already has ${existingTeams.length} teams set up - ` +
          "add or remove teams from the Teams panel instead of editing " +
          "Teams here.",
      );
    }

    // Every field here except `name` is locked once the draft has started
    // (see requireDraftNotStarted's comment) - compared field-by-field
    // rather than rejecting the whole call so a rename still goes through
    // mid-draft instead of needing its own dedicated mutation.
    if (draft.startedAt !== undefined) {
      const configUnchanged =
        fields.teamCount === season.teamCount &&
        fields.salaryCap === season.salaryCap &&
        fields.scoring === season.scoring &&
        fields.teScoring === (season.teScoring ?? "NONE") &&
        fields.sixPointPassTds === (season.sixPointPassTds ?? false) &&
        JSON.stringify(fields.rosterSlots) ===
          JSON.stringify(season.rosterSlots) &&
        JSON.stringify(fields.flexPositions) ===
          JSON.stringify(season.flexPositions) &&
        JSON.stringify(fields.superflexPositions) ===
          JSON.stringify(season.superflexPositions);
      if (!configUnchanged) {
        throw new Error(
          "This draft has already started - reopen pre-draft to change league settings.",
        );
      }
    }

    await ctx.db.patch(id, fields);
    if (league.name !== name) {
      await ctx.db.patch(league._id, { name });
    }
    // Every field here (teamCount, salaryCap, scoring, rosterSlots,
    // flex/superflexPositions) feeds getDraftValues' $ engine - see
    // convex/draftValues.ts.
    await invalidateDraftValues(ctx, draft._id);
    return await ctx.db.get(id);
  },
});

// Builds a synthetic prior-season entry for a just-created league from an
// imported Sleeper or Yahoo league's previous-season roster/auction results
// (see convex/sleeper/league.ts's previewSleeperImport and convex/infinidraft/yahoo/
// league.ts's previewYahooImport), inserted as an earlier season of the SAME
// league - seasons.by_league_year naturally orders it before the new season,
// no separate lineage-chain field needed the way draftSettings.clonedFromId
// used to require. The tradeoff (same as before): a fabricated season shows
// up in that league's history/delete-cascade like a real one.
export const importPreviousSeasonHistory = mutation({
  args: {
    newSeasonId: v.id("seasons"),
    season: v.string(),
    // Exactly one of these two is expected, matching whichever provider the
    // import wizard is running against - neither is required at the type
    // level so one mutation can serve both wizards instead of forking it.
    sleeperLeagueId: v.optional(v.string()),
    yahooLeagueKey: v.optional(v.string()),
    // Provider-specific "me" identifier in the imported league (Sleeper
    // user_id, or a Yahoo team_key - Yahoo has no separate owner id, see
    // seasonTeams.yahooTeamKey's schema comment) used only to flag which
    // synthetic team is isSelf (cosmetic - getPlayerPriceHistory returns
    // prices for every fpid league-wide regardless of which team held them,
    // so this doesn't affect keeper suggestions themselves).
    selfOwnerId: v.optional(v.string()),
    // The linked provider league's OWN previous-season draft format
    // (SNAKE_DRAFT.md §6/§8) - only Sleeper detects this today (see
    // convex/sleeper/league.ts's fetchPreviousSeasonPreview); absent for
    // Yahoo, or when Sleeper couldn't find a prior draft at all, in which
    // case every inserted pick falls back to the existing $-placeholder
    // behavior (see the round/price branch below).
    previousDraftType: v.optional(draftTypeValidator),
    teams: v.array(
      v.object({
        ownerId: v.string(),
        teamName: v.string(),
        players: v.array(
          v.object({
            fpid: v.number(),
            price: v.optional(v.number()),
            // Round counterpart to price (SNAKE_DRAFT.md §8) - only ever
            // sent when previousDraftType is "snake"/"linear".
            round: v.optional(v.number()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { season: newSeason, league } = await requireSeasonOwner(
      ctx,
      args.newSeasonId,
    );

    const existing = await ctx.db
      .query("seasons")
      .withIndex("by_league_year", (q) =>
        q.eq("leagueId", league._id).eq("year", args.season),
      )
      .first();
    if (existing) {
      throw new Error("This league already has a linked prior season.");
    }

    const now = Date.now();
    const historySeasonId = await ctx.db.insert("seasons", {
      leagueId: league._id,
      year: args.season,
      teamCount: args.teams.length,
      salaryCap: newSeason.salaryCap,
      scoring: newSeason.scoring,
      ...(newSeason.teScoring !== undefined
        ? { teScoring: newSeason.teScoring }
        : {}),
      ...(newSeason.sixPointPassTds !== undefined
        ? { sixPointPassTds: newSeason.sixPointPassTds }
        : {}),
      rosterSlots: newSeason.rosterSlots,
      flexPositions: newSeason.flexPositions,
      superflexPositions: newSeason.superflexPositions,
      ...(args.sleeperLeagueId
        ? { sleeperLeagueId: args.sleeperLeagueId }
        : {}),
      ...(args.yahooLeagueKey ? { yahooLeagueKey: args.yahooLeagueKey } : {}),
      createdAt: now,
    });
    const historyDraftId = await ctx.db.insert("drafts", {
      seasonId: historySeasonId,
      kind: "real",
      name: `${league.name} (Imported ${args.season})`,
      status: "complete",
      historySource: args.sleeperLeagueId ? "sleeper" : "yahoo",
      createdAt: now,
    });
    // Sleeper's team-assignment data here comes from /rosters (each team's
    // CURRENT roster, see convex/sleeper/league.ts's fetchLeagueTeamRows) -
    // already reflects any in-season trades/waivers, so it's a confirmed
    // end-of-season assignment, not a draft-day snapshot (schema.ts's
    // teamAssignmentConfirmed comment). Yahoo's equivalent instead comes
    // from actual draft results (convex/infinidraft/yahoo/league.ts's
    // fetchYahooDraftResults), which CAN go stale after a trade, so it
    // stays unconfirmed.
    const teamAssignmentConfirmed = args.sleeperLeagueId !== undefined;

    // Round-based history (SNAKE_DRAFT.md §8) never falls back to a $1
    // placeholder the way the auction/unknown-format path does below - a
    // stray dollar figure has no business showing up in an otherwise
    // round-denominated import. A player with no round found (e.g. added
    // via waiver after that season's draft) just gets a plain roster-
    // membership row with neither price nor round set.
    const isRoundBased =
      args.previousDraftType === "snake" || args.previousDraftType === "linear";

    let sequence = 0;
    for (const [index, team] of args.teams.entries()) {
      const teamId = await ctx.db.insert("seasonTeams", {
        seasonId: historySeasonId,
        name: team.teamName,
        isSelf:
          args.selfOwnerId !== undefined && team.ownerId === args.selfOwnerId,
        order: index,
        createdAt: now,
      });
      for (const player of team.players) {
        // Skip players this app has no identity/position record for (e.g.
        // retired since that season) - draftPicks.position is required and
        // there's nowhere else to source it from.
        const playerDoc = await ctx.db
          .query("players")
          .withIndex("by_fpid", (q) => q.eq("fpid", player.fpid))
          .first();
        if (!playerDoc) continue;
        sequence += 1;
        await ctx.db.insert("draftPicks", {
          draftId: historyDraftId,
          sequence,
          fpid: player.fpid,
          position: playerDoc.position,
          teamId,
          createdAt: now,
          ...(teamAssignmentConfirmed ? { teamAssignmentConfirmed } : {}),
          ...(isRoundBased
            ? player.round !== undefined
              ? { round: player.round }
              : {}
            : { price: player.price ?? 1 }),
        });
      }
    }

    return historySeasonId;
  },
});

// Toggles the Keepers tab on/off for this season - independent of
// updateSeason's batched Save so flipping it doesn't require re-submitting
// the whole league settings form. Doesn't touch keeperRules itself: turning
// keepers back on later restores whatever formula/tier config was already
// there.
//
// Keepers is a Pro feature - turning it on is rejected for a free-plan
// owner server-side too, not just disabled in the UI (src/pages/Settings/
// LeagueDetails.tsx), since this mutation is reachable directly. Turning
// it off is always allowed (e.g. after a downgrade, or a Pro owner just
// changing their mind) - only the true direction is gated.
export const setUseKeepers = mutation({
  args: {
    id: v.id("seasons"),
    useKeepers: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { season } = await requireDraftNotStarted(ctx, args.id);
    const league = await ctx.db.get(season.leagueId);
    if (!league) {
      throw new Error("League not found.");
    }
    if (args.useKeepers && !(await hasProAccess(ctx, league.ownerId))) {
      throw new Error("Keepers is a Pro feature. Upgrade to enable it.");
    }
    await ctx.db.patch(args.id, { useKeepers: args.useKeepers });
    return await ctx.db.get(args.id);
  },
});

// Corrects a season's draft format after creation - draftType is otherwise
// create-only/locked-in (see updateSeason below, which never accepts it),
// since switching formats mid-season would retroactively make already-
// recorded picks' round/price fields meaningless. This exists specifically
// for the case where the initial pick was simply wrong (e.g. a Sleeper
// import that couldn't detect the linked league's draft type, or guessed
// before the league's own draft settings existed) and nothing has actually
// happened yet - guarded on requireDraftNotStarted AND zero existing
// draftPicks (a pre-draft keeper is still a draftPicks row), not just the
// former, since a keeper added under the old format would otherwise be left
// with a price but no round (or vice versa).
export const setDraftType = mutation({
  args: {
    id: v.id("seasons"),
    draftType: draftTypeValidator,
  },
  handler: async (ctx, args) => {
    const { season, draft } = await requireDraftNotStarted(ctx, args.id);
    if (args.draftType === (season.draftType ?? "auction")) {
      return await ctx.db.get(args.id);
    }
    const existingPick = await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .first();
    if (existingPick) {
      throw new Error(
        "This league already has keepers or picks recorded - draft type can't be changed anymore.",
      );
    }
    await ctx.db.patch(args.id, { draftType: args.draftType });
    return await ctx.db.get(args.id);
  },
});

// Links (or unlinks, passing null) this season to a real Sleeper league for
// in-season roster/FAAB syncing - see convex/sleeper/league.ts. Separate from
// updateSeason so linking doesn't require resubmitting the whole league
// form, same reasoning as setUseKeepers above.
export const setSleeperLeagueId = mutation({
  args: {
    id: v.id("seasons"),
    sleeperLeagueId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.id);
    await ctx.db.patch(args.id, {
      sleeperLeagueId: args.sleeperLeagueId ?? undefined,
    });
    return await ctx.db.get(args.id);
  },
});

// Yahoo equivalent of setSleeperLeagueId above.
export const setYahooLeagueKey = mutation({
  args: {
    id: v.id("seasons"),
    yahooLeagueKey: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.id);
    await ctx.db.patch(args.id, {
      yahooLeagueKey: args.yahooLeagueKey ?? undefined,
    });
    return await ctx.db.get(args.id);
  },
});

// League-wide default in-season FAAB pool per team (null clears it back to
// unset - see seasonTeams.faabBudgetOverride for the per-team override).
export const setFaabBudget = mutation({
  args: {
    id: v.id("seasons"),
    faabBudget: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireSeasonOwner(ctx, args.id);
    if (args.faabBudget !== null && args.faabBudget < 0) {
      throw new Error("FAAB budget can't be negative.");
    }
    await ctx.db.patch(args.id, { faabBudget: args.faabBudget ?? undefined });
    return await ctx.db.get(args.id);
  },
});

// Cascade-deletes everything scoped to one season - teams, rosters, every
// draft (mock or real) and its picks/nominations/live-plan/tag state, then
// the season row itself. Factored out of deleteLeague below so it can run
// once per season in a league.
async function deleteOneSeason(ctx: MutationCtx, seasonId: Id<"seasons">) {
  const teams = await ctx.db
    .query("seasonTeams")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
  for (const team of teams) {
    for (const row of await ctx.db
      .query("rosterPlayers")
      .withIndex("by_team", (q) => q.eq("teamId", team._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(team._id);
  }

  const drafts = await ctx.db
    .query("drafts")
    .withIndex("by_season", (q) => q.eq("seasonId", seasonId))
    .collect();
  for (const draft of drafts) {
    for (const row of await ctx.db
      .query("draftPicks")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftNominations")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftBudgetPlans")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftLiveBudgetOverrides")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftPlayerTags")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftNominationTurns")
      .withIndex("by_draft", (q) => q.eq("draftId", draft._id))
      .collect()) {
      await ctx.db.delete(row._id);
    }
    for (const row of await ctx.db
      .query("draftValues")
      .withIndex("by_draft_week_scoring_teScoring_sixPointPassTds", (q) =>
        q.eq("draftId", draft._id),
      )
      .collect()) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(draft._id);
  }

  await ctx.db.delete(seasonId);
}

// Permanently deletes a league AND every season in its history - a league
// here means the whole multi-season history, not just the one season the
// user happened to have selected, so there's no "prior season became
// disconnected" leftover to worry about. Called from the League Details
// page's Delete League button, whose confirmation modal lists every season
// this will take with it (fetched via listSeasonLineage) since this can't be
// undone.
export const deleteLeague = mutation({
  args: { id: v.id("seasons") },
  handler: async (ctx, args) => {
    const { league } = await requireSeasonOwner(ctx, args.id);
    const seasons = await ctx.db
      .query("seasons")
      .withIndex("by_league", (q) => q.eq("leagueId", league._id))
      .collect();
    for (const season of seasons) {
      await deleteOneSeason(ctx, season._id);
    }
    await ctx.db.delete(league._id);
    return null;
  },
});
