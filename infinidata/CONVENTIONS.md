# Backend structure: vertical slices

`infinidata/convex/` is the single Convex deployment backing both `infinidraft` and
`infinileague` (they're SPAs with no backend of their own — see each app's
`vite.config.ts`/`tsconfig.json` `@infinidata` alias, which points at
`convex/_generated`). Convex generates its `api.*` RPC namespace directly from this
folder/file layout, so where a function lives *is* its public address
(`api.infinidraft.billing.getMySubscription`, etc).

## Where new code goes

- **infinidraft-only** → `convex/infinidraft/<domain>/<file>.ts`, generating
  `api.infinidraft.<domain>.<fn>`. Only `infinidraft/src` should ever reference
  `api.infinidraft.*`.
- **infinileague-only** → `convex/infinileague/<domain>/<file>.ts`, generating
  `api.infinileague.<domain>.<fn>`. Only `infinileague/src` should ever reference
  `api.infinileague.*`.
- **Genuinely shared** (both apps need it, or shared root infrastructure like
  `leagues.ts`/`schema.ts`/provider clients depends on it internally) → stays at
  the `convex/` root, in a named slice if it's more than one or two files (e.g.
  `players.ts`, `sleeper/`). Don't add to a shared slice just because two things
  happen to both be true today — only for stuff the team already treats as core,
  cross-app infra.
- **Pure TypeScript helpers with no `query`/`mutation`/`action` export** (no
  `api.*` surface at all) → `convex/lib/`. This is the preferred home for logic
  that's conceptually shared but doesn't need to be its own Convex function —
  see "Cross-app duplication" below.

**Important lesson from this migration**: a file's app-call-site count (grep
`api.<domain>.*` in each app's `src/`) is necessary but not sufficient to prove a
file is single-app. Several files had zero frontend call sites from one app but
were still genuinely shared because *another shared backend file* imported them
internally (e.g. `leagues.ts` calling into what looked like draft-only code).
Before moving a file into an app slice, grep for **both** app-side `api.*` call
sites **and** internal `convex/`-to-`convex/` imports from other files — especially
from `leagues.ts`, `schema.ts`, and the provider client folders (`sleeper/`,
`yahoo/`), which turned out to be the most common source of hidden shared
dependencies.

## Cross-app duplication over coupling

If both apps need essentially the same capability, **default to writing the Convex
function twice** — one thin function per app slice — rather than one shared
function both apps call. This is a deliberate tradeoff: a small amount of
duplicated boilerplate in exchange for a change to one app's function never being
able to break the other app.

Pull the *complex* part (the actual computation/validation, not the Convex
`query`/`mutation` wrapper) into a plain TypeScript helper under `convex/lib/`.

Two examples from this migration:
- `convex/infinidraft/draft/teams.ts`'s `initializeSeasonTeams` and
  `convex/infinileague/season/teams.ts`'s `initializeSeasonTeams` are separate,
  app-owned mutations with different arg shapes (infinileague's skips the Yahoo
  fields it'll never use), both calling `convex/lib/seasonTeams.ts`'s
  `insertSeasonTeams` for the actual row-insertion logic.
- `convex/infinidraft/season/faabValues.ts`'s and `convex/infinileague/season/
  faabValues.ts`'s `getFaabSuggestions` queries are identical thin wrappers, both
  calling `convex/lib/faab.ts`'s `computeFaabSuggestions` for the math.

Some cross-app plumbing genuinely can't be duplicated cleanly (an `internalQuery`/
`internalMutation` invoked via `ctx.runQuery`/`ctx.runMutation` from an `action`
context, where a plain function won't do) — those stay as one shared root file
(e.g. `convex/rosterSync.ts`, `convex/seasonTeams.ts`). Default to the
duplicate-thin-wrapper pattern first; only fall back to a shared root file when
the function has to be a real Convex function both apps' provider syncs invoke.

## Naming

- Reserve the bare word `auth` for identity/session (`auth.ts`, `auth.config.ts`,
  `authPasswordReset.ts`). A permission/ownership check module is `access.ts`, not
  `auth.ts` — draft-scoped authorization now lives at `convex/lib/access.ts`
  (turned out to be shared, not draft-room-specific — see migration status below).
- Don't nest a file with the same name as its folder (`players/players.ts` →
  `players/core.ts`).
- Per-provider integration folders (`sleeper/`, `yahoo/`, `espn/`) each having their
  own `client.ts`, `league.ts`, etc. is intentional and fine — different folders
  produce different `api.*` namespaces, so there's no real collision.

## Every PR touching `convex/`

1. `git mv` (not copy) so history follows the file.
2. Update internal `convex/`-to-`convex/` relative imports — including `http.ts` if
   it imports the moved file directly — and any `internal.<oldPath>.*` /
   `api.<oldPath>.*` references elsewhere in `convex/`.
3. Update every app-side call site: `grep -rl "api\.<oldPath>\." infinidraft/src
   infinileague/src`.
4. Sweep for stale comment references to the old path (`grep -rn "convex/<oldPath>"`)
   — this codebase's comments frequently cross-reference other files by path, and
   they go stale silently (no compiler error).
5. From `infinidata/`, run `npx convex dev --once` to regenerate
   `_generated/api.d.ts` against the dev deployment.
6. `npm run typecheck` in `infinidata`.
7. `npx tsc -b --force` (or `npm run build`) in both `infinidraft` and `infinileague`
   — use `--force` to bypass incremental-build caching when verifying a large
   rename, since a stale `.tsbuildinfo` can mask a broken import.
8. Manually smoke-test the affected screens against the dev deployment — there's no
   automated test suite yet.
9. PR targets `develop`, never `main` — merging to `main` triggers a production
   deploy of both apps.

## Migration status

Done, in this order:

- `email/resendClient.ts` → `lib/email.ts`.
- `billing/entitlements.ts` → `lib/entitlements.ts` (kept shared — a plain helper
  consumed by both `leagues.ts`, a shared root file, and infinidraft-only
  billing/draft code); the rest of `billing/` → `infinidraft/billing/`.
- `draft/auth.ts` → `lib/access.ts`, `draft/slots.ts` → `lib/rosterSlots.ts` —
  **reclassified from the original plan**, which assumed all of `draft/` was
  infinidraft-only. Both turned out to be consumed by `leagues.ts`,
  `genericLeague.ts`, `season/` (now `infinileague/season/`), and
  `sleeper/draftSync.ts` — genuinely shared ownership/roster-slot logic.
- The rest of `draft/` (live-draft engine, prep/planning, post-draft reporting —
  23 files total) → `infinidraft/draft/`. All confirmed zero infinileague call
  sites before moving.
- `draftValues.ts`, `valueGaps.ts`, `draftType.ts`, `scoring.ts` — **evaluated for
  a move to `infinidraft/values/`, reclassified as shared and left at the root.**
  `scoring.ts`/`draftType.ts` are imported by `schema.ts` itself (which can't
  move) plus `leagues.ts`, `playerPoints.ts`, `projectionBlending.ts`,
  `fetchAllData.ts`, `sleeper/`, `yahoo/`. `draftValues.ts`/`valueGaps.ts`'s
  cache-invalidation functions (`invalidateDraftValues`,
  `refreshDraftValuesForLeague`, `ensureValueGapsCached`) are called inline by
  `leagues.ts`'s `createLeague`/`updateSeason`. These four files mix genuinely
  infinidraft-only query functions with genuinely shared internals tightly enough
  that splitting them wasn't a safe mechanical move — left as a candidate for a
  future, carefully-scoped split (extract just the shared cache-invalidation
  calls into `lib/`) rather than forced through here.
- `draft/teams.ts` split three ways: `insertSeasonTeams` → `lib/seasonTeams.ts`
  (shared row-insertion logic); `listSeasonTeamsInternal` → `seasonTeams.ts` (new
  shared root file — needed as a real `internalQuery` by `sleeper/league.ts`'s
  `syncLeagueRoster`, used by both apps); the rest of the CRUD (owner-scoped
  `listSeasonTeams`, `addSeasonTeam`, `removeSeasonTeam`, etc.) →
  `infinidraft/draft/teams.ts`; a new, separate, trimmed `initializeSeasonTeams`
  → `infinileague/season/teams.ts`.
- `season/` split: `standings.ts`, and the infinileague-only parts of
  `rosterPlayers.ts` (`requireOwnedTeamForRead`, `listRosterFpidsForTeam`,
  `getRosterSyncStatus`) and `teamRoster.ts` → `infinileague/season/`.
  `rosterPlayers.ts`'s shared sync plumbing (`requireOwnedSeasonForSync`,
  `replaceRosterForTeam`, `updateSeasonWaiverSettings` — called by
  `sleeper/league.ts`'s `syncLeagueRoster`, which both apps' roster-sync flows
  trigger, plus infinidraft's own `sleeper/draftSync.ts`/`yahoo/league.ts`) →
  new shared root file `rosterSync.ts`. `faabValues.ts`'s computation →
  `lib/faab.ts`; both apps got their own thin `getFaabSuggestions` wrapper at
  `infinidraft/season/faabValues.ts` and `infinileague/season/faabValues.ts`.
- `gemini/` and `yahoo/` → `infinidraft/gemini/` and `infinidraft/yahoo/`
  (confirmed infinidraft-only). `http.ts`'s Yahoo OAuth callback route (root,
  can't move) now imports `infinidraft/yahoo/client.ts` directly and calls
  `internal.infinidraft.yahoo.oauth.*` — this one shared-root-into-app-slice
  reach is expected and fine, same as `fetchAllData.ts`'s reach into
  `infinidraft/draft/fetchHelpers.ts` below.
- `fantasyPros/client.ts`'s `requireSuperAdmin`/`currentSeason` (generic
  admin-gate/season-default helpers with nothing FantasyPros-specific about
  them, used by every provider's data-fetch actions) → `lib/dataFetch.ts`.

**Expected, permanent shared-root-reaches-into-infinidraft-slice call sites** (not
bugs, don't "fix" by moving these back or by moving their targets out of
`infinidraft/`):
- `fetchAllData.ts` (shared daily-sync cron orchestrator) calls
  `internal.infinidraft.draft.fetchHelpers.getRealDraftInternal` to find which
  seasons have a real (non-generic) draft whose `draftValues` cache needs
  refreshing.
- `http.ts`'s Yahoo OAuth callback calls `internal.infinidraft.yahoo.oauth.*` and
  imports `infinidraft/yahoo/client.ts` directly.

**Deferred — not done, and deliberately left for a future, separately-scoped
pass**: grouping the remaining flat shared root files (`players.ts`,
`playerNameMatch.ts`, `playerPoints.ts`, `projections.ts`, `providerProjections.ts`,
`projectionBlending.ts`, `rankings.ts`, `standardValues.ts`, `positions.ts` →
`players/`; `leagues.ts`, `genericLeague.ts` → `leagues/`; `nflState.ts`,
`nflSchedule.ts`, `injuries.ts`, `injurySnapshots.ts` → `nfl/`). Every one of these
files is already correctly shared — this would be pure folder/naming
reorganization, not a risk-reduction move. `leagues.ts` alone has ~35 app-side
call-site files; the whole group is 75+ across both apps. Skipped because the
risk (large mechanical rename across two live-prod apps, no test suite) isn't
justified by the reward (cosmetic grouping — no cross-app coupling is reduced by
this move, unlike every other phase above). Revisit as several small, independent
PRs if/when it's worth the churn.
