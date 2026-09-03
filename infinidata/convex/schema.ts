import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { positionValidator } from "./positions";
import { scoringValidator, teScoringValidator } from "./scoring";
import { draftTypeValidator } from "./draftType";

// Shared by seasons/drafts below.
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

// Round-denominated counterpart to the dollar formula below - used when
// keeperRulesValidator's costMode is "round" (SNAKE_DRAFT.md §8). Move a
// kept player up this many rounds per consecutive year kept (e.g. drafted/
// kept in round 8 last year, roundsEarlier: 2 -> costs round 6 this year),
// floored at minimumRound (typically 1 - can't draft earlier than round 1).
// undraftedRound is the round-mode counterpart to the dollar formula's
// undraftedCost - the round a player who wasn't drafted/kept last season
// (no prior round on record at all) costs to keep, since roundsEarlier has
// nothing to subtract from in that case. Leagues commonly have their own
// rule for this (last round, last round minus one, a fixed round, etc.) -
// same "explicitly configurable, not hardcoded" reasoning as undraftedCost.
const keeperRoundFormulaValidator = v.object({
  roundsEarlier: v.number(),
  minimumRound: v.optional(v.number()),
  undraftedRound: v.optional(v.number()),
});

// Shared by leagues/seasons below.
const keeperRulesValidator = v.object({
  // Absent means "dollar" - every row written before this field existed is
  // an auction league's keeper rules, which only ever meant the dollar
  // formula. "round" switches every cost computation in src/lib/
  // keeperCost.ts over to the *RoundFormula fields below instead - the two
  // modes are mutually exclusive per season, not blendable.
  costMode: v.optional(v.union(v.literal("dollar"), v.literal("round"))),
  defaultFormula: v.object({
    multiplier: v.number(),
    flatAdd: v.number(),
    minimumCost: v.optional(v.number()),
    undraftedCost: v.optional(v.number()),
  }),
  // Only meaningful when costMode is "round" - kept optional (not required
  // alongside defaultFormula) since every existing row predates this and
  // is dollar-only.
  defaultRoundFormula: v.optional(keeperRoundFormulaValidator),
  tiers: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      maxSize: v.optional(v.number()),
      formula: v.object({
        multiplier: v.number(),
        flatAdd: v.number(),
        minimumCost: v.optional(v.number()),
      }),
      // Round-formula counterpart to `formula` above, same "only meaningful
      // when costMode is round" relationship as defaultRoundFormula.
      roundFormula: v.optional(keeperRoundFormulaValidator),
      fpids: v.array(v.number()),
      // Whole positions this rule also applies to, in addition to fpids -
      // optional so existing tiers written before this field existed still
      // validate; treat an absent value as "no positions" (see
      // formulaForFpid in src/lib/keeperCost.ts).
      positions: v.optional(v.array(positionValidator)),
    }),
  ),
  maxKeepersPerTeam: v.optional(v.number()),
  maxConsecutiveYears: v.optional(v.number()),
  // Only meaningful when costMode is "round" (SNAKE_DRAFT.md §8) - two of a
  // team's keepers can independently compute to the SAME round (e.g. both
  // drafted round 7 last year, same roundsEarlier). Since a team only has
  // one slot per round, the second one has to move - this decides which
  // direction: "earlier" (a round closer to 1, i.e. a more expensive slot)
  // or "later" (a round further from 1, cheaper). Absent means "earlier" -
  // see convex/infinidraft/draft/pickSlots.ts's resolveRoundConflict, which walks in
  // this direction from the computed round until it finds this team's
  // first open slot.
  roundConflictResolution: v.optional(
    v.union(v.literal("earlier"), v.literal("later")),
  ),
  // No longer independently user-set - convex/infinidraft/draft/keeperRules.ts's
  // setKeeperRules derives and overwrites this on every save from whether
  // maxConsecutiveYears above is defined (an undefined/unlimited max means
  // the same thing this toggle being off used to mean), rather than trusting
  // whatever a client sends. Readers can keep using this field directly
  // (kept in sync on every save) or derive the same thing themselves from
  // maxConsecutiveYears.
  trackConsecutiveYears: v.optional(v.boolean()),
});

export default defineSchema({
  ...authTables,

  userProfiles: defineTable({
    // Optional + still indexed during migration away from tokenIdentifier;
    // see convex/users.ts for the legacy-lookup/self-heal path.
    userId: v.optional(v.id("users")),
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    role: v.union(v.literal("super-admin"), v.literal("user")),
    createdAt: v.number(),
  })
    .index("by_user_id", ["userId"])
    .index("by_token_identifier", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  // One row per user (upserted, never duplicated) - mirrors yahooOAuthTokens'
  // shape below. Source of truth for Pro plan access; see
  // convex/lib/entitlements.ts's hasProAccess. Kept separate from
  // userProfiles (rather than adding fields there) so login-time profile
  // patches (convex/users.ts's ensureCurrentUser) and webhook-driven billing
  // writes never touch the same document - they run on independent
  // schedules and would otherwise risk OCC conflicts against each other.
  subscriptions: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    priceId: v.optional(v.string()),
    status: v.union(
      v.literal("none"),
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("incomplete"),
      v.literal("incomplete_expired"),
      v.literal("unpaid"),
    ),
    currentPeriodEnd: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    // Manual super-admin override - independent of and coexists with a real
    // Stripe subscription (see hasProAccess: either alone is sufficient).
    comped: v.boolean(),
    compedBy: v.optional(v.id("userProfiles")),
    compedAt: v.optional(v.number()),
    compedNote: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  // Idempotency guard for the Stripe webhook handler (convex/billing/
  // webhookHandler.ts) - Stripe delivers webhooks at-least-once, so every
  // event id is claimed here before it's acted on.
  stripeWebhookEvents: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    processedAt: v.number(),
  }).index("by_event_id", ["stripeEventId"]),

  // Cached Stripe Price lookup for the Pro plan's price (unit amount,
  // currency, billing interval) - see convex/billing/pricing.ts. Fetched
  // from Stripe's API on demand and cached here rather than live-fetched on
  // every "Go Pro" callout/Billing page view, same reasoning as
  // draftValues/valueGaps caching elsewhere. Keyed by priceId (rather than
  // being a hardcoded single row) so a STRIPE_PRO_PRICE_ID rotation is
  // self-healing - a changed price id just misses the cache once and
  // refetches, instead of showing a stale amount forever.
  proPricingCache: defineTable({
    priceId: v.string(),
    unitAmount: v.number(),
    currency: v.string(),
    interval: v.string(),
    fetchedAt: v.number(),
  }).index("by_price_id", ["priceId"]),

  // Player identity, derived as a side effect of the Sleeper projections
  // fetch (see convex/sleeper/projections.ts) - Sleeper's player_id is the
  // fpid used everywhere except DST, which has no numeric id upstream (see
  // DEF_TEAM_FPIDS in convex/sleeper/client.ts). The single source of truth
  // for name/team/position - projections/rankings/news/injuries all
  // reference players by fpid rather than duplicating identity.
  players: defineTable({
    fpid: v.number(),
    name: v.string(),
    position: positionValidator,
    team: v.union(v.string(), v.null()),
    // From Sleeper's player.years_exp (0 = rookie season). Absent for DST
    // (synthetic team-defense fpids have no underlying Sleeper player
    // object) and for any player fetched before this field existed.
    yearsExp: v.optional(v.number()),
    // Cross-platform ids, backfilled from Sleeper's full player list (see
    // convex/sleeper/playerLinks.ts - NOT the trimmed per-player object
    // nested in the projections/stats endpoints this table is otherwise
    // populated from, which omits both). Confirmed live that ESPN's own
    // numeric player id equals Sleeper's espn_id, so this is an exact join
    // key for convex/espn/rankings.ts rather than a fuzzy name match.
    // Absent for DST (synthetic fpids have no underlying Sleeper player
    // object to source these from) and for any player never matched.
    espnId: v.optional(v.number()),
    yahooId: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_fpid", ["fpid"])
    .index("by_espn_id", ["espnId"]),

  // External platforms' own player values/rankings, for comparing against
  // this app's own draft values rather than replacing them - see convex/
  // espn/rankings.ts for the first source (ESPN's draft-kit ranks).
  // platform/format are kept as growable literal unions (rather than
  // free-form strings) so a bad source name fails at the schema instead of
  // silently fragmenting rows; add a literal here when a new platform or
  // format (e.g. Yahoo) is wired up. format is confirmed against ESPN's own
  // draftRanksByRankType values - it has no half-PPR variant, and its
  // fourth type (ELIMINATION) is a single-elimination survivor game mode,
  // not a redraft scoring format, so it's deliberately not one of these.
  // One row per (platform, format, season, fpid) - overwritten in place as
  // a season's rankings move rather than kept as history, mirroring
  // proPricingCache's refetch-and-overwrite approach above.
  standardValues: defineTable({
    platform: v.literal("espn"),
    format: v.union(
      v.literal("standard"),
      v.literal("ppr"),
      v.literal("superflex"),
    ),
    season: v.string(),
    fpid: v.number(),
    rank: v.number(),
    auctionValue: v.number(),
    fetchedAt: v.number(),
  })
    .index("by_platform_format_season_fpid", [
      "platform",
      "format",
      "season",
      "fpid",
    ])
    .index("by_fpid", ["fpid"]),

  // From Sleeper's projections endpoint (see convex/sleeper/projections.ts).
  // One row per (position, week, fpid); a single fetch returns all three
  // scoring variants at once.
  // For QB/RB/WR/TE, this table is now a derived cache: convex/
  // projectionBlending.ts writes it from providerProjections below (see that
  // table's comment), not directly from any one provider - pointsStd/Half/
  // Ppr are the average of every provider's own computeProjectedPoints
  // result (convex/scoring.ts), and stats is those providers' raw category
  // stats merged (averaged per shared category, else whichever provider has
  // it). K/DST bypass blending entirely and are still written directly from
  // Sleeper (see convex/sleeper/projections.ts) - K/DST scoring isn't
  // reproduced by computeProjectedPoints, so there's nothing to blend yet.
  projections: defineTable({
    fpid: v.number(),
    season: v.string(),
    week: v.string(),
    position: positionValidator,
    // Snapshotted from players at fetch time so the projections table page
    // can render without an extra lookup per row; players stays authoritative.
    name: v.string(),
    team: v.union(v.string(), v.null()),
    pointsStd: v.number(),
    pointsPpr: v.number(),
    pointsHalf: v.number(),
    // One-step lookback, stashed from the prior fetch's pointsX right before
    // upsertProjections overwrites this row (see that mutation) - lets
    // convex/lib/faab.ts detect a same-week projection spike (e.g. a
    // practice-squad promotion the projection system just caught up to)
    // without needing a full time-series history table. Absent on this
    // row's very first fetch, or if the row predates this field. previousFetchedAt
    // is this row's OWN fetchedAt from before that overwrite, so a consumer
    // can tell a same-day rerun (no real gap) from a genuine day-over-day
    // jump - both previous* fields are only ever set/read together.
    previousPointsStd: v.optional(v.number()),
    previousPointsPpr: v.optional(v.number()),
    previousPointsHalf: v.optional(v.number()),
    previousFetchedAt: v.optional(v.number()),
    // Flexible stat map since QB/RB/WR/TE/DST each expose different columns
    // (e.g. "rec_yd", "rush_td", "pass_att"). See convex/sleeper/projections.ts.
    stats: v.record(v.string(), v.number()),
    fetchedAt: v.number(),
  })
    .index("by_position_week", ["position", "week"])
    .index("by_position_week_fpid", ["position", "week", "fpid"]),

  // Each external provider's own raw per-category projected stats, kept
  // separate per provider rather than blended in place - convex/
  // projectionBlending.ts reads every provider's row for a (position,
  // season, week) here and averages them into the projections cache above.
  // provider is a growable literal union (same reasoning as
  // standardValues.platform above) so a new source is "add a literal + a
  // fetch that translates its fields into this table's shared stat-category
  // vocabulary" (Sleeper's own naming - pass_yd, rush_td, rec, etc., see
  // sleeper/projections.ts's numericStats) without touching the blending
  // logic at all. QB/RB/WR/TE only, for the same reason as projections above.
  providerProjections: defineTable({
    provider: v.union(v.literal("sleeper"), v.literal("espn")),
    season: v.string(),
    week: v.string(),
    fpid: v.number(),
    position: positionValidator,
    stats: v.record(v.string(), v.number()),
    fetchedAt: v.number(),
  })
    .index("by_provider_season_week_fpid", [
      "provider",
      "season",
      "week",
      "fpid",
    ])
    .index("by_position_season_week", ["position", "season", "week"]),

  // From Sleeper's projections endpoint's adp_* fields - a season/week
  // snapshot like projections, so ADP movement over time is preserved rather
  // than only ever holding the latest value. Sleeper has no "expert
  // consensus rank" concept (that was FantasyPros-specific) - only ADP.
  rankings: defineTable({
    fpid: v.number(),
    season: v.string(),
    week: v.string(),
    position: positionValidator,
    adpStd: v.number(),
    adpPpr: v.number(),
    adpHalf: v.number(),
    fetchedAt: v.number(),
  })
    .index("by_position_week", ["position", "week"])
    .index("by_position_week_fpid", ["position", "week", "fpid"]),

  // From /nfl/{year}/player-points. Actual (not projected) fantasy points,
  // exploded from the API's nested `weeks` map into one row per week so this
  // table is index-compatible with projections/rankings for comparison views.
  playerPoints: defineTable({
    fpid: v.number(),
    season: v.string(),
    week: v.string(),
    position: positionValidator,
    scoring: scoringValidator,
    points: v.number(),
    // Per-category box score for that week (pass_yd, rush_td, rec, etc.) -
    // same shape as projections.stats. Optional because rows written before
    // this field existed predate it and aren't backfilled automatically;
    // every row written going forward always includes it (see
    // convex/sleeper/playerPoints.ts). Reused across STD/PPR/HALF rows for
    // the same fpid/week since the box score itself doesn't vary by scoring
    // format, only the derived `points` total does.
    stats: v.optional(v.record(v.string(), v.number())),
    fetchedAt: v.number(),
  })
    .index("by_position_week", ["position", "week"])
    .index("by_season_week_fpid", ["season", "week", "fpid"])
    // Powers "this player's whole game log for one season" (see
    // getPlayerGameLog in convex/playerPoints.ts) - same 3-field key as
    // playerSeasonStats's write-path index below, since playerPoints itself
    // is still only ever stored per base scoring (3 rows/week), never per
    // teScoring/sixPointPassTds (those bonuses are derived at read time from
    // this row's `stats` blob, not stored as separate rows here).
    .index("by_fpid_season_scoring", ["fpid", "season", "scoring"]),

  // Season-long digest of playerPoints, maintained incrementally by
  // upsertPlayerPoints (see convex/playerPoints.ts) rather than recomputed at
  // read time. Exists solely so convex/valueGaps.ts can read one row per
  // (fpid, season, scoring) instead of scanning all 18 weeks - that
  // week-by-week scan across 4 positions was measured (via `npx convex
  // insights`) exceeding the 32k-documents-per-transaction limit. A 0-point
  // week is treated as "didn't play" here too (mirrors valueGaps.ts's old
  // in-query logic), so totalPoints/gamesPlayed already reflect that filter -
  // readers don't need to re-derive it.
  playerSeasonStats: defineTable({
    fpid: v.number(),
    season: v.string(),
    position: positionValidator,
    scoring: scoringValidator,
    // teScoring/sixPointPassTds extend the key alongside scoring so every
    // league-scoring combination (base PPR tier x TE-premium tier x passing-TD
    // value) gets its own row instead of one bonus-unaware row per base
    // scoring - see bonusPoints in convex/scoring.ts, which this table now
    // folds in rather than ignoring. A prior-season row's totals never change
    // once that season is over, so precomputing every combination here is
    // strictly cheaper than recomputing bonusPoints against raw playerPoints
    // rows on every read.
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
    totalPoints: v.number(),
    gamesPlayed: v.number(),
    // Running sum of points^2 across counted games - not itself a consumer
    // field, but the sufficient statistic that lets variance/stdDeviation be
    // updated incrementally (each week's contribution is independently
    // additive) instead of recomputed from every game each write. Not yet
    // read anywhere - stored now so a future "consistency rating" feature
    // doesn't need a playerPoints rescan/backfill to get it.
    sumSquaredPoints: v.number(),
    // Population variance/stdDeviation of per-game points, derived from the
    // running sums above on every write (see applySeasonStatsDelta in
    // convex/playerPoints.ts).
    variance: v.number(),
    stdDeviation: v.number(),
    // Downside semi-deviation: same population-variance formula as
    // stdDeviation above, but only over games that fell below the season's
    // own PPG (games at or above the mean contribute 0). Unlike
    // stdDeviation, this can't be derived from a running sum-of-squares -
    // whether a given game counts as "below" depends on the season's final
    // mean, which shifts with every new game - so it's recomputed from
    // playerPoints on each write (see computeDownsideDeviation in
    // convex/playerPoints.ts). Consistency labels (src/lib/consistency.ts)
    // use this instead of stdDeviation so a player's occasional monster game
    // doesn't inflate their variance the same way a genuine bust week does.
    downsideDeviation: v.number(),
    updatedAt: v.number(),
  })
    // Read path: valueGaps.ts pulls every fpid for one
    // position/season/scoring-config combination.
    .index("by_position_season_scoring_teScoring_sixPointPassTds", [
      "position",
      "season",
      "scoring",
      "teScoring",
      "sixPointPassTds",
    ])
    // Write path: upsertPlayerPoints looks up (and updates) one player's row
    // per scoring-config combination as each week's points come in.
    .index("by_fpid_season_scoring_teScoring_sixPointPassTds", [
      "fpid",
      "season",
      "scoring",
      "teScoring",
      "sixPointPassTds",
    ]),

  // From /nfl/injuries. Current-status only (the endpoint has no season/week)
  // - one row per currently-injured player, deleted when they drop off the
  // API's list (recovered), mirroring how upsertProjections handles removals.
  injuries: defineTable({
    fpid: v.number(),
    status: v.string(),
    statusShort: v.string(),
    injuryType: v.string(),
    comment: v.string(),
    irWeeks: v.array(v.number()),
    probabilityOfPlaying: v.union(v.number(), v.null()),
    practice1: v.union(v.string(), v.null()),
    practice2: v.union(v.string(), v.null()),
    practice3: v.union(v.string(), v.null()),
    practiceReportInjuryType: v.union(v.string(), v.null()),
    updatedAt: v.number(),
    fetchedAt: v.number(),
  }).index("by_fpid", ["fpid"]),

  // Append-only history of injury-status *changes*, captured going forward
  // from whenever this table was introduced - Sleeper's injury_status field
  // (above) is a "right now" value with no historical archive, so past
  // seasons can never be backfilled here. A new row is only inserted when a
  // player's status actually differs from their most-recently-stored row
  // (see convex/injurySnapshots.ts's recordSnapshots) - deliberately NOT
  // one-row-per-fetch, since the daily fetch cadence spans every team's
  // Thursday/Sunday/Monday games within a single week number, and
  // overwriting by week could silently clobber an earlier-in-the-week
  // designation with unrelated later information.
  injurySnapshots: defineTable({
    fpid: v.number(),
    season: v.string(),
    // The week this change was captured during (Sleeper's state.week, or
    // "0" outside the regular season) - not necessarily the only status
    // change that occurred that week, just when this row was recorded.
    week: v.string(),
    status: v.string(),
    statusShort: v.string(),
    injuryType: v.string(),
    comment: v.string(),
    fetchedAt: v.number(),
  })
    // "This player's most-recently-stored snapshot" - the change-detection
    // check in recordSnapshots (query this, order desc, take first()).
    .index("by_fpid", ["fpid"])
    // "Every change this player had during one season" - the game log's
    // read (src/components/PlayerSeasonGameLog.tsx), grouped by week
    // client-side since a week can have more than one row.
    .index("by_fpid_season", ["fpid", "season"]),

  // Live NFL week/season snapshot, refreshed daily alongside the rest of
  // fetchAllData (see convex/sleeper/state.ts's fetchNflSeasonState and
  // convex/fetchAllData.ts). Exists because queries can't reach Sleeper
  // themselves - anything read-only that needs "what week is it right now"
  // (e.g. the in-season FAAB calculator) reads this table instead. Single
  // row, always upserted in place rather than keyed by season/week, since
  // only the current value is ever needed.
  nflState: defineTable({
    season: v.string(),
    week: v.string(),
    seasonType: v.union(
      v.literal("pre"),
      v.literal("regular"),
      v.literal("post"),
    ),
    updatedAt: v.number(),
  }),

  // Durable league identity - rarely written, one per real-world league
  // regardless of how many seasons/years it's played. A league's year-to-year
  // history is just seasons.by_league, ordered by year/createdAt - no
  // separate lineage-chain field needed.
  leagues: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    createdAt: v.number(),
  }).index("by_owner", ["ownerId"]),

  // Permanent, non-decrementing record of "this user used one of their
  // free-tier league slots for this calendar year" - see convex/leagues.ts's
  // createLeague. Rows are never deleted, not even when the league they
  // were granted for is later deleted via deleteLeague - that's the whole
  // point: the free-tier gate counts grant rows here, not how many leagues
  // currently exist, so deleting a league and immediately creating a new
  // one doesn't refund the free slot. One row per free league creation (up
  // to FREE_LEAGUES_PER_YEAR per (userId, year) - see convex/billing/
  // entitlements.ts) - a Pro user never gets a row written (see
  // hasProAccess check in createLeague), so downgrading back to free later
  // still starts fresh based only on actual free-tier usage history.
  freeLeagueGrants: defineTable({
    userId: v.id("users"),
    year: v.string(),
    createdAt: v.number(),
  }).index("by_user_year", ["userId", "year"]),

  // One per league per year - this season's actual format (roster shape,
  // scoring, cap, provider links). The unit most of the app's "league
  // settings" UI actually edits.
  seasons: defineTable({
    leagueId: v.id("leagues"),
    year: v.string(),
    teamCount: v.number(),
    // Absent means "auction" - see draftType.ts's resolveDraftType. Drives
    // which of the app's format-specific builds/subsystems apply to this
    // season (SNAKE_DRAFT.md §2/§5); locked once teams/picks exist, same as
    // scoring/rosterSlots below.
    draftType: v.optional(draftTypeValidator),
    salaryCap: v.number(),
    scoring: scoringValidator,
    // TE-only reception bonus / 6pt-passing-TD toggle - both v.optional since
    // existing seasons rows predate this feature. Absent means "NONE"/false,
    // i.e. exactly the pre-feature behavior - see scoring.ts's
    // scoringConfigFromSeason, which every reader should go through rather
    // than assuming presence.
    teScoring: v.optional(teScoringValidator),
    sixPointPassTds: v.optional(v.boolean()),
    rosterSlots: rosterSlotsValidator,
    flexPositions: v.array(positionValidator),
    superflexPositions: v.array(positionValidator),
    // Sleeper/Yahoo mint a new league id each year, so these are correctly
    // season-scoped rather than durable across every season of a league.
    sleeperLeagueId: v.optional(v.string()),
    yahooLeagueKey: v.optional(v.string()),
    faabBudget: v.optional(v.number()),
    // Which waiver system this league actually uses - determines whether
    // infinileague's standings page shows remaining FAAB $ or waiver order
    // (see convex/infinileague/season/standings.ts). Provider-agnostic values, not raw
    // Sleeper's numeric waiver_type - set/refreshed by convex/sleeper/
    // league.ts's syncLeagueRoster on every sync (not just at connect time),
    // so a season connected before this field existed self-heals on its
    // next sync, and a mid-season commissioner change doesn't go stale.
    waiverType: v.optional(v.union(v.literal("faab"), v.literal("priority"))),
    useKeepers: v.optional(v.boolean()),
    keeperRules: v.optional(keeperRulesValidator),
    createdAt: v.number(),
  })
    .index("by_league", ["leagueId"])
    .index("by_league_year", ["leagueId", "year"]),

  // A draft within a season - a season can have many (mock drafts) but at
  // most one with kind "real" (enforced by convex/infinidraft/draft/history.ts's season
  // creation, which always creates exactly one "real" draft alongside the
  // season). Auction-session config defaults from the season at creation but
  // can diverge (e.g. a mock testing a different cap) - though today's UI
  // only ever creates the one real draft.
  drafts: defineTable({
    seasonId: v.id("seasons"),
    kind: v.union(v.literal("mock"), v.literal("real")),
    name: v.string(),
    // Overrides seasons.draftType for this draft only - same
    // override-the-season-default pattern as salaryCap/rosterSlots below.
    // Only useful for a mock draft testing a different format than the
    // season's real one; today's UI never creates a second draft, so in
    // practice this is always absent and resolveDraftType falls through to
    // the season's own draftType.
    draftType: v.optional(draftTypeValidator),
    salaryCap: v.optional(v.number()),
    rosterSlots: v.optional(rosterSlotsValidator),
    flexPositions: v.optional(v.array(positionValidator)),
    superflexPositions: v.optional(v.array(positionValidator)),
    // Meaningless outside a live auction.
    nominationOrder: v.optional(v.array(v.id("seasonTeams"))),
    nominationOrderMode: v.optional(
      v.union(v.literal("linear"), v.literal("snake")),
    ),
    // A real snake/linear draft's round-1 pick order (SNAKE_DRAFT.md §3.1) -
    // the counterpart to nominationOrder above, kept as its own field rather
    // than reusing that one even though the underlying rotation math is
    // shared (convex/infinidraft/draft/pickOrder.ts's stepPickOrder): nominationOrder is
    // documented (see nominate() in picks.ts) as only ever a suggestion the
    // host can override anytime, whereas a snake draft's order is meant to
    // be closer to authoritative. "linear" here means a straight round-robin
    // with no direction bounce (see draftType.ts's DraftType) - distinct
    // from nominationOrderMode's own "linear", which is the same concept
    // applied to auction's nomination suggestion instead of a real pick
    // order. Seeded once, pre-draft (randomized or manually set - see
    // SNAKE_DRAFT.md §3.1's open question on a "randomize" action);
    // meaningless for an auction-type draft.
    draftOrder: v.optional(v.array(v.id("seasonTeams"))),
    // Rounds (1-indexed) where the natural snake bounce is additionally
    // reversed - {3} alone reproduces classic 3rd-round reversal
    // (SNAKE_DRAFT.md §10). Absent/empty means plain snake. Meaningless for
    // "linear" (no bounce to reverse) or auction drafts.
    reversalRounds: v.optional(v.array(v.number())),
    status: v.union(
      v.literal("pre_draft"),
      v.literal("in_progress"),
      v.literal("complete"),
    ),
    // Set once, explicitly, by convex/infinidraft/draft/lifecycle.ts's startDraft (and
    // cleared by its reopenPreDraft) - the actual "has this draft been
    // deliberately started" flag. `status` above is still derived (see
    // convex/infinidraft/draft/status.ts's syncDraftStatus) but now as a function of
    // this field plus roster fullness, NOT of raw pick count - a keeper
    // added before the draft starts must not flip status away from
    // "pre_draft", since keepers are just draftPicks rows with isKeeper: true.
    startedAt: v.optional(v.number()),
    // How this draft's picks got into the database when they weren't run
    // through this app's own live auction - absent means a real in-app
    // draft (or a season with no history at all yet). Set by
    // convex/leagues.ts's importPreviousSeasonHistory ("sleeper"/"yahoo")
    // and convex/infinidraft/draft/manualHistory.ts's setManualPreviousSeasonResults
    // ("manual"). Distinguishes which historical seasons the manual-entry
    // edit UI is allowed to touch (only "manual" today - see
    // manualHistory.ts) from a real draft's history, which should never be
    // silently overwritten this way.
    historySource: v.optional(
      v.union(v.literal("sleeper"), v.literal("yahoo"), v.literal("manual")),
    ),
    // Live sync from an in-progress Sleeper auction draft (see convex/
    // sleeper/draftSync.ts) - distinct from historySource, which only ever
    // describes a past, already-completed import. sleeperDraftId is the
    // specific Sleeper draft this real draft is mirroring, resolved
    // automatically from seasons.sleeperLeagueId at link time rather than
    // pasted in by the user. sleeperSyncEnabled is the master on/off switch
    // the poller re-reads every hop; sleeperSyncGeneration is bumped on
    // every (re)enable so a stale poll chain (from a prior enable/disable
    // cycle) recognizes it's superseded and stops instead of running
    // alongside a fresh chain. sleeperLastSyncedAt/sleeperSyncError(Count)
    // drive the UI's live status readout and the auto-disable-after-
    // repeated-failures behavior. sleeperDraftScheduledAt (Sleeper's own
    // start_time) is cached independently of sleeperSyncEnabled -
    // fetchSleeperDraftSchedule refreshes it just from a Sleeper league
    // link, pre-draft, so the host can see the scheduled time on the
    // Dashboard/Settings/Draft tab without turning live sync on.
    sleeperDraftId: v.optional(v.string()),
    sleeperDraftScheduledAt: v.optional(v.number()),
    sleeperSyncEnabled: v.optional(v.boolean()),
    sleeperSyncGeneration: v.optional(v.number()),
    // Deprecated - superseded by the draftSyncStatus table below. Left
    // declared (rather than removed) so any doc that still carries a stale
    // value from before that split stays schema-valid; nothing writes these
    // three anymore. Do NOT resume writing to them - see draftSyncStatus's
    // comment for why they moved off this document.
    sleeperLastSyncedAt: v.optional(v.number()),
    sleeperSyncError: v.optional(v.string()),
    sleeperSyncErrorCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_season_kind", ["seasonId", "kind"])
    .index("by_season_status", ["seasonId", "status"]),

  // Live-sync heartbeat, split out of `drafts` itself: convex/sleeper/
  // draftSync.ts's poll chain writes lastSyncedAt/syncError every ~3s while
  // a live Sleeper sync is running, whether or not a new pick came in. That
  // used to patch the `drafts` document directly - since virtually every
  // Draft Room query (getDraftBoard, listDraftPicks, listSeasons, etc, via
  // requireDraftOwner/requireRealDraft) reads that same document, every
  // heartbeat write invalidated and forced a full recompute of ALL of them,
  // for every subscribed client, every 3 seconds - the actual cause of one
  // live-synced snake draft reading 2.42GB in a single session. Isolating
  // this high-churn heartbeat here (same pattern the Convex guidelines call
  // for: separate high-churn operational data from stable profile data)
  // means writing it only invalidates readers of THIS document - just
  // convex/sleeper/draftSync.ts's own getSyncStatus - leaving the expensive
  // queries to recompute only when something they actually depend on
  // (draftPicks, draftValues, drafts' own rarely-written fields) changes.
  draftSyncStatus: defineTable({
    draftId: v.id("drafts"),
    lastSyncedAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    syncErrorCount: v.optional(v.number()),
  }).index("by_draft", ["draftId"]),

  // The season's durable team roster - one table shared by every draft in
  // the season (mock or real), so mocks can't diverge in team count/shape.
  // Includes the owner's own team (isSelf: true) - keeping "me" as a real row
  // makes budget math and the League tab symmetric across every team instead
  // of special-casing one.
  seasonTeams: defineTable({
    seasonId: v.id("seasons"),
    name: v.string(),
    isSelf: v.boolean(),
    order: v.number(),
    createdAt: v.number(),
    // Overrides seasons.salaryCap for this team only - absent means this
    // team just uses the league default.
    salaryCapOverride: v.optional(v.number()),
    // Links this team to a real Sleeper roster/owner once seasons.
    // sleeperLeagueId is set - see convex/sleeper/league.ts's syncLeagueRoster
    // and the team-mapping step in Settings. Absent means unmapped.
    sleeperRosterId: v.optional(v.string()),
    sleeperOwnerId: v.optional(v.string()),
    // Yahoo equivalent of sleeperRosterId - see convex/infinidraft/yahoo/league.ts's
    // syncYahooLeagueRoster.
    yahooTeamKey: v.optional(v.string()),
    // In-season FAAB spent so far, synced from the linked provider roster -
    // defaults to 0 until the first sync.
    faabSpent: v.optional(v.number()),
    // Overrides seasons.faabBudget for this team only.
    faabBudgetOverride: v.optional(v.number()),
    // Current-season standings, synced from the linked provider roster
    // alongside faabSpent above (see convex/sleeper/league.ts's
    // syncLeagueRoster) - powers convex/infinileague/season/standings.ts. All absent
    // until the first sync, same as faabSpent. pointsFor/pointsAgainst are
    // real decimal totals (provider APIs commonly split whole/hundredths
    // internally - already combined by the time it lands here).
    wins: v.optional(v.number()),
    losses: v.optional(v.number()),
    ties: v.optional(v.number()),
    pointsFor: v.optional(v.number()),
    pointsAgainst: v.optional(v.number()),
    // Only meaningful when seasons.waiverType is "priority" - lower means
    // higher priority (1 = first). Absent for a FAAB league.
    waiverPosition: v.optional(v.number()),
  }).index("by_season", ["seasonId"]),

  // One team's currently-rostered players, synced from whichever provider
  // this season is linked to (convex/sleeper/league.ts's syncLeagueRoster or
  // convex/infinidraft/yahoo/league.ts's syncYahooLeagueRoster) - provider-agnostic by
  // design, since the only consumer (convex/lib/faab.ts) only ever
  // needs "which fpids does this team currently have," never which provider
  // synced them. Replace-all-on-sync per team: every existing row for a
  // teamId is deleted and reinserted fresh on each sync, the same pattern
  // upsertProjections uses for injuries/rankings - simpler than diffing
  // adds/drops, and in-season roster syncs are manually triggered (not
  // high-frequency) so the delete+reinsert cost is a non-issue.
  rosterPlayers: defineTable({
    seasonId: v.id("seasons"),
    teamId: v.id("seasonTeams"),
    fpid: v.number(),
    syncedAt: v.number(),
  })
    .index("by_season", ["seasonId"])
    .index("by_team", ["teamId"]),

  // One row per (season, NFL week) a power-rankings computation has been
  // run for - just the resulting rank order, not the points themselves
  // (those are cheap to recompute from live projections, but "what order
  // were teams in last week" isn't, once this week's projections have
  // overwritten last week's). Ordered teamIds only, index 0 = rank 1 - see
  // convex/infinileague/season/powerRankings.ts, which upserts this every
  // time it runs (so same-week reruns after a trade/waiver just refresh
  // this week's row) and reads the latest prior week's row to compute each
  // team's rank delta.
  powerRankingSnapshots: defineTable({
    seasonId: v.id("seasons"),
    week: v.string(),
    teamIds: v.array(v.id("seasonTeams")),
    computedAt: v.number(),
  }).index("by_season_week", ["seasonId", "week"]),

  // One row per (season, week, player) - a full weekly history of every
  // rosterable player's value, rostered or free agent (unlike faabValues,
  // which only ever surfaces free agents). Upserted daily by convex/rosVor.ts's
  // refreshRosVor, keyed by week so a same-week rerun refreshes that week's
  // numbers in place rather than piling up duplicates, and a new row only
  // appears once the NFL week actually advances - "weekly snapshots" for
  // free out of a daily cron, same trick powerRankingSnapshots above uses.
  // Every past week's row stays (never deleted/overwritten across weeks),
  // so this doubles as the full-season history next season's draft prep
  // wants, not just a "current" cache the way draftValues is.
  rosVorSnapshots: defineTable({
    seasonId: v.id("seasons"),
    week: v.string(),
    fpid: v.number(),
    position: positionValidator,
    // Snapshotted from players at compute time, same reasoning as
    // projections.name/team - renders a full weekly board without an extra
    // lookup per row.
    name: v.string(),
    team: v.union(v.string(), v.null()),
    // Forward-looking: rest-of-season value (recency/volume-adjusted
    // momentum on top of projections, see convex/lib/playerValue.ts) above
    // this position's replacement level among the current free-agent pool -
    // same VOR concept convex/draftValues.ts's pre-draft process uses,
    // genuinely unclamped (can go negative) for the same reason that field
    // is. rosRank is the display-facing int derived from it (1 = best,
    // global across every position) - UI should show rosRank, not raw
    // rosVor, per the product call on how this should read.
    rosVor: v.number(),
    rosRank: v.number(),
    // Raw rest-of-season value (same momentum-adjusted number rosVor is
    // computed from, injury boost included) - stored alongside rosVor so a
    // consumer like convex/lib/faab.ts can read a ready-made per-player
    // value straight off this cache instead of recomputing convex/lib/
    // playerValue.ts's momentum/injury-boost machinery on every live query.
    // Optional since rows written before this field existed predate it -
    // convex/lib/faab.ts treats a missing value as a cache miss for that
    // row (see its own comment).
    rosValue: v.optional(v.number()),
    // Injury-boost narrative, when this row's rosValue includes one (see
    // playerValue.ts's findInjuryBoosts) - stored so a cache consumer
    // doesn't have to redo boost detection just to explain a surprising
    // number. Same optionality reasoning as rosValue above.
    boostReason: v.optional(v.string()),
    // Backward-looking: this season's actual points scored so far
    // (playerSeasonStats.totalPoints for this league's exact scoring
    // combo) above the same free-agent-pool replacement level, computed
    // off actual totals instead of rosValue - "who has actually delivered
    // value this season," independent of projections entirely. Same
    // display convention as rosVor/rosRank above.
    actualVor: v.number(),
    actualRank: v.number(),
    computedAt: v.number(),
  })
    .index("by_season_week", ["seasonId", "week"])
    .index("by_season_fpid", ["seasonId", "fpid"]),

  // One row per app user (not per league) - connecting a Yahoo account is a
  // one-time action that then lets that user link any of their Yahoo leagues
  // to any of their infinidraft leagues, mirroring how leagues.ownerId already
  // scopes everything else per-user. See convex/infinidraft/yahoo/oauth.ts.
  yahooOAuthTokens: defineTable({
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.string(),
    // Epoch ms - convex/infinidraft/yahoo/oauth.ts's withYahooToken refreshes proactively
    // a few minutes before this, rather than waiting for a 401.
    expiresAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Short-lived nonce bridging Yahoo's OAuth redirect (an unauthenticated
  // browser navigation - no Convex auth session survives that trip) back to
  // "which app user, and optionally which season's Settings page, started
  // this." Generated by startYahooAuth right before redirecting to Yahoo,
  // consumed (looked up and deleted) exactly once by the /yahoo/callback
  // HTTP route in convex/http.ts. See convex/infinidraft/yahoo/oauth.ts.
  yahooOAuthState: defineTable({
    state: v.string(),
    userId: v.id("users"),
    seasonId: v.optional(v.id("seasons")),
    createdAt: v.number(),
  }).index("by_state", ["state"]),

  // A completed auction result - one row per player won. `sequence` is
  // monotonic per draft and is the sole source of truth for "last pick"
  // (undo) and "pick N of M"; nothing stores a running budget balance
  // anywhere, so REMAINING is always salaryCap - sum(picks.price) and undo
  // is a plain delete.
  draftPicks: defineTable({
    draftId: v.id("drafts"),
    sequence: v.number(),
    fpid: v.number(),
    position: positionValidator,
    teamId: v.id("seasonTeams"),
    // WIDENED from required (see SNAKE_DRAFT.md §3.2) - meaningless for a
    // snake/linear pick. Existing (auction) rows already have a real
    // number here, so this widening needs no backfill; every reader that
    // used to treat this as a definite number needs a null-check or an
    // upstream draftType branch instead.
    price: v.optional(v.number()),
    // Round/pick-in-round/overall-pick metadata - only ever set for a
    // snake/linear-format draft's picks (see resolveDraftType in
    // convex/draftType.ts). Stored explicitly rather than derived from
    // `sequence` + team count at read time: `sequence` is purely insertion/
    // display order (tolerates manual corrections, undo, out-of-order
    // entry) and isn't necessarily the canonical draft slot once traded/
    // forfeited picks (phase 2, SNAKE_DRAFT.md §9) mean "which slot is pick
    // #47" stops being a pure function of team count - a later trade
    // shouldn't retroactively rewrite an earlier pick's own round/slot.
    round: v.optional(v.number()),
    pickInRound: v.optional(v.number()),
    overallPick: v.optional(v.number()),
    // Which budget-plan slot this fills, e.g. "RB2" - only ever set (and only
    // ever read) for the self team, at pick time, to reconcile the live
    // auction price against that slot's pre-draft $ plan (see
    // convex/infinidraft/draft/budgetAutoAdjust.ts). Purely a budget bucket tag now, not
    // a lineup/starter assignment - which roster slot a player is actually
    // starting in is always computed fresh from current points (see
    // src/lib/slotAssignment.ts's optimalAssignPicksToSlots), for every team,
    // with no manual override.
    planSlotKey: v.optional(v.string()),
    // True for a pre-draft keeper assignment (see convex/infinidraft/draft/picks.ts's
    // addKeeper), absent/false for a normal auction result. Optional rather
    // than required so existing rows need no backfill - `eq("isKeeper",
    // true)` never matches a row where the field is absent either way.
    isKeeper: v.optional(v.boolean()),
    // Consecutive seasons (including this one) this player has been kept,
    // by any team - only meaningful when isKeeper is true. Auto-suggested
    // by addKeeper's computeKeeperStreak (see convex/infinidraft/draft/picks.ts) from
    // the immediately-prior season's value when this fpid was also a
    // keeper then, and always overridable afterward via setKeeperStreak
    // (e.g. to backfill real-world keeper history from before this app
    // tracked it) - next season's suggestion chains off whatever value
    // ends up here. Optional rather than required so existing rows need no
    // backfill; treated as 1 wherever read.
    keeperStreak: v.optional(v.number()),
    // True when `teamId` is known to be correct as of end of season, not
    // just wherever this player was drafted/imported to - only ever set by
    // convex/infinidraft/draft/manualHistory.ts's setManualPreviousSeasonResults, where
    // the user is directly asserting current team. A pick imported from a
    // provider's draft-day data (see importPreviousSeasonHistory) leaves
    // this absent, since trades/waiver moves after the draft mean the
    // drafting team isn't reliably who ended up with the player - see
    // convex/infinidraft/draft/history.ts's getPlayerPriceHistory, which only surfaces
    // a team name to callers (e.g. Recommended Keepers) when this is true.
    teamAssignmentConfirmed: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_draft", ["draftId"])
    .index("by_draft_sequence", ["draftId", "sequence"])
    .index("by_draft_fpid", ["draftId", "fpid"])
    // Scoped to isKeeper===true so draftValues.ts can read "just the
    // keepers" without its query being invalidated by every live auction
    // pick - see the comment on that read in convex/draftValues.ts.
    .index("by_draft_keeper", ["draftId", "isKeeper"]),

  // One row per (draftId, round, original-owner) slot whose ownership has
  // actually been touched - traded away, forfeited, or claimed by a
  // round-based keeper (SNAKE_DRAFT.md §8/§9). Lazily created, NOT one row
  // per round x team up front: absence of a row for a given (draftId,
  // round, originalTeamId) means "untouched - still owned by
  // originalTeamId, still open for a live pick," so a league with zero
  // trades/forfeits/keepers never writes to this table at all (same
  // "invisible until touched" convention as draftLiveBudgetOverrides).
  // Only meaningful for a snake/linear-format draft - auction has no slot
  // concept to trade or forfeit.
  draftPickSlots: defineTable({
    draftId: v.id("drafts"),
    round: v.number(),
    // Stable identity for the slot across trades - baseOrder[P] from
    // drafts.draftOrder, i.e. whichever team originally held this round's
    // Pth slot before any trade.
    originalTeamId: v.id("seasonTeams"),
    // null = forfeited (no one picks this slot - see isDraftComplete's
    // comment on the roster-fullness implication). A non-null value other
    // than originalTeamId means the slot was traded.
    currentTeamId: v.union(v.id("seasonTeams"), v.null()),
    // Set when a round-based keeper (see draftPicks.isKeeper) claims this
    // slot pre-draft, rather than it being traded/forfeited - the slot is
    // filled (not available for a live pick) but currentTeamId still
    // reflects who owns/owned it, for display consistency with the trade
    // case. draftPicks is the source of truth for which player/keeper
    // actually filled it; this just marks the slot itself as spoken for.
    claimedByKeeper: v.optional(v.boolean()),
    // Optional provenance for display ("via trade with Team X") - not
    // load-bearing for draft mechanics, purely informational.
    note: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_draft", ["draftId"])
    .index("by_draft_round", ["draftId", "round"])
    .index("by_draft_original_team", ["draftId", "originalTeamId"]),

  // The single live "on the block" nomination for a draft, if any. Kept as
  // its own table rather than a field on drafts so that fast-changing
  // bid-stepper clicks don't re-render every subscriber of the drafts row.
  // At most one row per draftId.
  draftNominations: defineTable({
    draftId: v.id("drafts"),
    fpid: v.number(),
    position: positionValidator,
    nominatingTeamId: v.optional(v.id("seasonTeams")),
    currentBid: v.number(),
    createdAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // The self team's PRE-DRAFT planned $ allocation per roster slot (keys
  // from expandRosterSlots, e.g. "RB1"/"FLEX"/"BN3") - one row per draft,
  // edited from the Setup app's Budget tab, before entering the Draft Room.
  // This is the baseline a new season's draft carries forward from the prior
  // one - draftLiveBudgetOverrides (below) deliberately isn't, since it's
  // specific to how one draft actually played out.
  draftBudgetPlans: defineTable({
    draftId: v.id("drafts"),
    amounts: v.record(v.string(), v.number()),
    overspendBehavior: v.union(
      v.literal("bench"),
      v.literal("spread"),
      v.literal("ask"),
    ),
    updatedAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // Live, in-draft overrides to the pre-draft plan above - only the slots
  // the user has explicitly reallocated during THIS draft are stored here;
  // every other slot keeps mirroring draftBudgetPlans.amounts live, so an
  // edit to the pre-draft plan after the draft has started still flows
  // through for any slot nobody has touched yet. The effective live amount
  // for a slot is `overrides[key] ?? draftBudgetPlans.amounts[key] ?? 0` -
  // see convex/infinidraft/draft/plan.ts's getLiveBudgetPlan, which computes that merge
  // server-side so every consumer (matchPlanSlot, useTeamBudget, MyTeamTab)
  // reads one already-merged shape instead of re-deriving it. One row per
  // draft, absence means "fully mirroring the pre-draft plan, nothing
  // overridden yet".
  draftLiveBudgetOverrides: defineTable({
    draftId: v.id("drafts"),
    overrides: v.record(v.string(), v.number()),
    // Falls back to draftBudgetPlans.overspendBehavior when unset, same
    // mirror-until-touched relationship as `overrides` has with `amounts`.
    overspendBehavior: v.optional(
      v.union(v.literal("bench"), v.literal("spread"), v.literal("ask")),
    ),
    updatedAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // A manual "target"/"avoid" annotation on a player, scoped to one draft -
  // pure user preference, not derived from anything, so (unlike tiers) this
  // genuinely needs to be stored rather than computed. One row per
  // (draftId, fpid); absence of a row means "no opinion".
  draftPlayerTags: defineTable({
    draftId: v.id("drafts"),
    fpid: v.number(),
    tag: v.union(v.literal("target"), v.literal("avoid")),
    // Dense 0..n-1 rank among this draft's "target" rows only - the
    // Shortlist tab's display/drag order (see reorderShortlist in
    // convex/infinidraft/draft/tags.ts). Assigned when a player is first tagged target
    // (appended to the end) and rewritten across the whole list on reorder;
    // meaningless/unset for "avoid" rows, which have no ordering UI.
    order: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_draft", ["draftId"])
    .index("by_draft_fpid", ["draftId", "fpid"]),

  // Live "whose turn is it" pointer - only meaningful when the draft's
  // nominationOrder (auction) or draftOrder (snake/linear, see drafts.
  // draftOrder below) is configured. At most one row per draft. Serves both
  // formats (SNAKE_DRAFT.md §3.1): for auction this is only ever a
  // suggestion the nominate UI defaults to (see setCurrentNominator -
  // always overridable, never enforced); for a real snake/linear draft
  // it's closer to authoritative, since there really is a single team "on
  // the clock." currentTeamId is null when the host has explicitly cleared
  // "whose turn" (e.g. running a pre-cycle top-X auction with no fixed
  // nominator before the regular rotation begins) - distinct from no row
  // existing yet, which just means the order was configured but the cycle
  // hasn't been started. direction only matters in "snake" mode (see
  // convex/infinidraft/draft/pickOrder.ts's stepPickOrder) - it's what lets the team at
  // each end of the order take two consecutive turns before reversing,
  // matching a standard snake draft's round-boundary behavior.
  draftNominationTurns: defineTable({
    draftId: v.id("drafts"),
    currentTeamId: v.union(v.id("seasonTeams"), v.null()),
    direction: v.union(v.literal(1), v.literal(-1)),
    updatedAt: v.number(),
  }).index("by_draft", ["draftId"]),

  // Precomputed cache of convex/valueGaps.ts's getAllValueGaps result, keyed
  // by the same (week, scoring, lastSeason) triple the query is called with.
  // That computation reads full projections/rankings/playerSeasonStats docs
  // (the `stats` blob included) across 4 positions on every call - cheap
  // once, but every open PlayersTable/PlayersLeftTab/PlayerDetailModal
  // subscription recomputing it from scratch was the single largest
  // contributor to this project's Convex database-bandwidth usage. Refreshed
  // once daily by refreshValueGaps, scheduled from fetchAllData right after
  // the underlying data changes - getAllValueGaps reads this table first and
  // only falls back to a live recompute on a cache miss (e.g. a
  // week/scoring/lastSeason combo the daily refresh hasn't covered yet).
  valueGaps: defineTable({
    week: v.string(),
    scoring: scoringValidator,
    // Part of this table's cache key (see convex/scoring.ts's ScoringConfig)
    // even though lastYearPpg itself stays base-scoring-only (playerSeasonStats
    // isn't bonus-aware, see that table's comment) - only this year's
    // projection-derived fields (points-based ranks/gaps) actually vary with
    // these two, but the whole row is still keyed by the full config since a
    // league only ever reads one combo at a time.
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
    lastSeason: v.string(),
    fpid: v.number(),
    position: positionValidator,
    direction: v.union(
      v.literal("undervalued"),
      v.literal("overvalued"),
      v.literal("breakout"),
      v.literal("falloff"),
    ),
    gap: v.number(),
    lastYearPpg: v.number(),
    lastYearGames: v.number(),
    lastYearRank: v.number(),
    projRank: v.number(),
    adpRank: v.number(),
    poolSize: v.number(),
  }).index("by_week_scoring_teScoring_sixPointPassTds_lastSeason", [
    "week",
    "scoring",
    "teScoring",
    "sixPointPassTds",
    "lastSeason",
  ]),

  // Precomputed cache of convex/draftValues.ts's getDraftValues result, keyed
  // by (draftId, week, scoring) - same reasoning as valueGaps above: that
  // computation reads every active position's full projections docs (the
  // unused `stats` blob included) plus keepers, and was recomputed from
  // scratch on every one of its 5+ call sites' subscriptions. Refreshed once
  // daily by refreshDraftValues (one call per real draft, at that league's
  // own scoring format - see fetchAllData.ts), and eagerly invalidated
  // whenever something that actually changes the computation happens off the
  // daily cycle (a keeper added/removed, or season settings edited - see
  // invalidateDraftValues, called from convex/infinidraft/draft/picks.ts and
  // convex/leagues.ts). getDraftValues reads this table first and only falls
  // back to a live recompute on a cache miss (a combo the daily refresh
  // hasn't covered yet, or one just invalidated).
  draftValues: defineTable({
    draftId: v.id("drafts"),
    week: v.string(),
    scoring: scoringValidator,
    teScoring: teScoringValidator,
    sixPointPassTds: v.boolean(),
    fpid: v.number(),
    name: v.string(),
    team: v.union(v.string(), v.null()),
    position: positionValidator,
    points: v.number(),
    positionRank: v.number(),
    replacementPoints: v.number(),
    usedFallback: v.boolean(),
    valueOverReplacement: v.number(),
    dollarValue: v.number(),
    // Read/write path (getDraftValues/refreshDraftValues) queries the full
    // key; the invalidation path (a keeper change or settings edit doesn't
    // know which week/scoring combos are cached) queries just the draftId
    // prefix to clear all of them at once - unaffected by teScoring/
    // sixPointPassTds joining the index, since that prefix-delete never adds
    // further .eq()s beyond draftId.
  }).index("by_draft_week_scoring_teScoring_sixPointPassTds", [
    "draftId",
    "week",
    "scoring",
    "teScoring",
    "sixPointPassTds",
  ]),

  // AI-written (Gemini) narrative recap for one completed real draft's
  // Report Card - see convex/infinidraft/gemini/reportSummary.ts's generateReportSummary
  // action, scheduled once by convex/infinidraft/draft/status.ts's syncDraftStatus the
  // moment a real draft transitions into status "complete". Generate-once,
  // best-effort, and is never regenerated even if picks are corrected
  // after the draft is marked complete (same known gap as
  // draftReportCardSnapshots below - see its comment). Generated from -
  // and only ever consistent with - the frozen draftReportCardSnapshots row
  // for the same (draftId, week, scoring), not whatever draftValues would
  // compute live today. convex/infinidraft/draft/reportCard.ts's getDraftReportCardPublic
  // reads this table and falls back to a free templated recap
  // (src/lib/reportCardSummary.ts) when no row exists yet.
  draftReportSummaries: defineTable({
    draftId: v.id("drafts"),
    week: v.string(),
    scoring: scoringValidator,
    summary: v.string(),
    // Per-team blurbs from the same Gemini call as `summary` - optional
    // because rows generated before this field existed won't have it; the
    // Report Card just falls back to the templated per-team summary
    // (src/lib/reportCardSummary.ts) whenever a team has no entry here.
    teamSummaries: v.optional(
      v.array(v.object({ teamId: v.id("seasonTeams"), summary: v.string() })),
    ),
    model: v.string(),
    generatedAt: v.number(),
  }).index("by_draft_week_scoring", ["draftId", "week", "scoring"]),

  // Freezes convex/infinidraft/draft/reportCard.ts's computeReportCardData output the
  // first time it's computed for a (draftId, week, scoring) - see that
  // file's ensureReportCardSnapshot. Exists because every number on the
  // Report Card (dollar value, surplus, VOR, grade, every rank) is derived
  // from draftValues, which is NOT stable over time: convex/crons.ts
  // refetches projections daily, so re-running the computation later can
  // produce different numbers than what was true right after the draft.
  // Without this, the numeric stat rows (always recomputed live) and the
  // cached AI recap (generated once, see draftReportSummaries above) would
  // silently drift apart within a day or two.
  //
  // `data` is the verbatim return value of computeReportCardData - stored
  // as v.any() rather than a full mirrored validator because that shape is
  // large, nested, and owned entirely by reportCard.ts; the only reader is
  // that same file, which casts it back on the way out.
  //
  // A commissioner correcting a pick after the draft is already "complete"
  // doesn't automatically invalidate an existing row here, so the
  // snapshot (and any AI recap built from it) can go stale relative to
  // the actual roster - the Report Card's "Regenerate" button
  // (regenerateReportSummary) is the manual fix: it clears this row too,
  // not just the AI text, and lets it recompute fresh.
  draftReportCardSnapshots: defineTable({
    draftId: v.id("drafts"),
    week: v.string(),
    scoring: scoringValidator,
    data: v.any(),
    generatedAt: v.number(),
  }).index("by_draft_week_scoring", ["draftId", "week", "scoring"]),

  // AI-written pre-draft strategy takeaways (Pro feature) - see convex/
  // gemini/preDraftInsights.ts's generatePreDraftInsights and convex/infinidraft/draft/
  // insights.ts's getPreDraftInsights. Keyed on seasonId rather than
  // draftId (unlike draftReportSummaries above): this runs before a draft
  // exists to grade, off the season's live pre-draft state instead of a
  // frozen post-draft snapshot.
  preDraftInsights: defineTable({
    seasonId: v.id("seasons"),
    week: v.string(),
    scoring: scoringValidator,
    insights: v.array(v.object({ headline: v.string(), body: v.string() })),
    // JSON snapshot of the user-controlled inputs (scoring config, roster
    // shape, keeper rules, which fpids are kept) present at generation time -
    // deliberately excludes the daily-refreshed projections/ADP/$ data,
    // which changes constantly and would make every row "stale" within a
    // day. getPreDraftInsights recomputes this same fingerprint on every
    // read and flags a mismatch as stale in the UI, without auto-clearing
    // this cache - same manual-only invalidation convention as
    // draftReportSummaries.
    inputsFingerprint: v.string(),
    model: v.string(),
    generatedAt: v.number(),
  }).index("by_season_week_scoring", ["seasonId", "week", "scoring"]),

  // Points at the one system-owned league/season/draft used to serve every
  // free-tier user the exact same draftValues - see convex/genericLeague.ts's
  // ensureGenericSeason (idempotent - creates this once) and convex/
  // draftValues.ts's getDraftValues (reads it for the !proAccess branch,
  // ignoring the caller's own league's scoringConfig entirely, so a free
  // user can't get their real league's exact custom numbers by just asking
  // with their own scoring settings). Single row, always exactly one -
  // nothing after ensureGenericSeason's first run ever inserts a second.
  // That system league is a real row in leagues/seasons/drafts (kind:
  // "real") owned by a dedicated placeholder users row, not any real
  // person's account, so it flows through the exact same computeDraftValues/
  // refreshDraftValues path (and the nightly refreshCachedComputations loop
  // over listAllSeasons) as any other league, and never appears in any real
  // user's own league list (leagues.by_owner is keyed by the signed-in
  // user's id, which this placeholder owner never is).
  genericLeagueConfig: defineTable({
    seasonId: v.id("seasons"),
  }),
});
