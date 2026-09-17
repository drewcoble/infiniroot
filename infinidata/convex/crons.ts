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

// Tank01's weekly game schedule - re-enabled (was parked): infinifaab's
// Sleeper bid-eligibility now directly gates on kickoff time (see
// convex/infinileague/auction/eligibility.ts's rule 1 and convex/sleeper/
// transactions.ts's drop-cycle exception check), making fresh nflGames data
// a hard dependency rather than the abandoned drop-derived waiver-clear
// computation this used to only feed. Every 6h (not once/day like the
// depth-charts cron above) since staleness here now has real bidding
// consequences, not just a cosmetic "clears a bit late" - still well within
// Tank01's 1,000/month free-tier cap (see TANK01.md) alongside that daily
// depth-chart call.
crons.cron(
  'fetch tank01 nfl schedule',
  '0 */6 * * *',
  internal.tank01.schedule.fetchScheduleInternal,
  {},
)

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

// Sleeper's own equivalent of the refresh above - detects drop transactions
// and opens a dedicated bid cycle for the dropped player (see convex/
// sleeper/transactions.ts's detectSleeperDrops for the full mechanism, and
// its own comment for why this is a separate cron entry rather than folded
// into refreshAllSeasons above, which is Yahoo-only by design). Same 20-min
// cadence, a no-op for every Yahoo-linked or disabled league.
crons.interval(
  'detect sleeper player drops',
  { minutes: 20 },
  internal.sleeper.transactions.detectSleeperDropsAllSeasons,
  {},
)

// Self-healing backstop for auction cycles - the precise close for each
// cycle is its own ctx.scheduler.runAt call (see convex/infinileague/
// auction/cycles.ts), this just makes sure a weekly cycle exists whenever
// one should (and self-heals any cycle type whose close job was somehow
// lost). Same 15-min-ish cadence as the waiver refresh above.
crons.interval(
  'ensure auction cycles',
  { minutes: 15 },
  internal.infinileague.auction.cycles.ensureAuctionCycles,
  {},
)

export default crons
