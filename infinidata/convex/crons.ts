import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Refetch draft projections + players/rankings/injuries/player-points (all
// Sleeper) and news (FantasyPros) once a day. No `week` arg - fetchAllInternal
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

export default crons
