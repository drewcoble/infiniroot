import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Refetch draft projections + players/rankings/injuries/player-points (all
// Sleeper) once a day. No `week` arg - fetchAllInternal
// auto-detects the current NFL week via Sleeper's state endpoint on every
// run (cron args are static at deploy time, so a hardcoded value here would
// never update on its own).
//
// Calls fetchAllInternal, NOT the public api.fetchAllData.fetchAll - a
// cron-triggered call has no signed-in user (ctx.auth.getUserIdentity() is
// always null here), so the public action's requireSuperAdmin gate would
// throw on every run. See fetchAllData.ts's comment on fetchAllInternal.
crons.cron(
  'fetch draft data',
  '0 12 * * *',
  internal.fetchAllData.fetchAllInternal,
  {},
)

// Tank01's depth charts, once a day - a separate cron entry rather than
// folded into fetchAllInternal above, so a Tank01-side failure (missing
// TANK01_API_KEY, rate limit) can never take down the existing Sleeper/ESPN
// refresh those other actions depend on. Same '0 12 * * *' cadence as
// fetchAllInternal - one bulk call/day is what the free-tier 1,000/month cap
// (see TANK01.md) is sized for; do not add per-player or more-frequent
// Tank01 calls without revisiting that budget.
crons.cron(
  'fetch tank01 depth charts',
  '0 12 * * *',
  internal.tank01.depthCharts.fetchDepthChartsInternal,
  {},
)

// Tank01's weekly game schedule - NOT currently scheduled. This only ever
// fed convex/sleeper/transactions.ts's drop-derived waiver-clear
// computation, which real-world testing showed was wrong for Sleeper
// eligibility (see convex/infinileague/auction/eligibility.ts) and is no
// longer wired into anything read at runtime. Parked rather than deleted -
// re-enable with the same cadence as the depth-charts cron above
// (internal.tank01.schedule.fetchScheduleInternal) if a future need
// (e.g. a priority-waiver league where the game-time distinction matters
// more) brings that computation back.

// infinifaab's waiver-eligibility refresh - much more frequent than every
// other cron here on purpose: a stale read risks declaring an auction
// winner for a player someone already grabbed for real on the actual
// platform (see schema.ts's waiverPlayers comment). Yahoo-only now (see
// waiverSync.ts's own comment) - a no-op for every Sleeper-linked or
// disabled league.
crons.interval(
  'refresh waiver-eligible players',
  { minutes: 20 },
  internal.infinileague.auction.waiverSync.refreshAllSeasons,
  {},
)

// Self-healing backstop for weekly auction cycles - the precise close for
// each cycle is its own ctx.scheduler.runAt call (see convex/infinileague/
// auction/cycles.ts), this just makes sure a new cycle exists whenever one
// should. Same 15-min-ish cadence as the waiver refresh above.
crons.interval(
  'ensure auction cycles',
  { minutes: 15 },
  internal.infinileague.auction.cycles.ensureAuctionCycles,
  {},
)

export default crons
