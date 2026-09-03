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

export default crons
