# infinileague — architecture plan

Companion in-season app to infinidraft: waiver-wire recommendations, FAAB bid
suggestions, and trade analysis, hosted at `infinileague.com`. This doc is the
result of researching infinidraft's current stack/data model and deciding how
the two apps share a backend and a login. Decisions below reflect the three
calls made 2026-08-30 (SSO level, repo topology, billing) — see each section
for the reasoning and the alternative that was passed on.

## 1. What infinidraft already has that infinileague needs

Confirmed by reading the code, not assumed:

- **League sync, already provider-agnostic**: `convex/espn/`, `convex/sleeper/`,
  `convex/yahoo/` each normalize into a shared shape consumed by
  `convex/genericLeague.ts` and `convex/leagues.ts`. infinileague needs the
  same three providers for the same reason (pull a user's real league/roster) —
  this is not new work, it's the same sync code called from new UI.
- **Player valuation engine**: `convex/standardValues.ts`,
  `convex/projectionBlending.ts`, `convex/providerProjections.ts`,
  `convex/valueGaps.ts`, `convex/draftValues.ts`, `convex/scoring.ts`,
  `convex/injuries.ts` / `injurySnapshots.ts` — this is the values math the
  user wants for waiver/trade analysis, already scoring-format-aware.
- **There's already an in-season module**: `convex/season/faabValues.ts`
  computes rest-of-season value, replacement value, VOR, a need multiplier,
  and a suggested FAAB bid per team — i.e. a working first draft of
  infinileague's core feature already exists inside infinidraft.
  `convex/season/rosterPlayers.ts` sits next to it. infinileague's waiver/FAAB
  feature is an extension of this module, not a new domain.
- **Auth**: `@convex-dev/auth` with a `Password` provider
  ([convex/auth.ts](convex/auth.ts)), users in the standard `authTables` +
  app-specific `userProfiles` (keyed by stable `userId`, not the
  session-rotating `tokenIdentifier` — see [convex/users.ts](convex/users.ts)).
- **Billing**: `convex/billing/` — `subscriptions` keyed by `userId`,
  `hasProAccess()` checks `comped || status in {active, past_due}`. Entirely
  user-scoped already, nothing league- or app-specific baked into it.
- **Hosting**: Vite/React SPA on Vercel, one Convex project (`drafto-v3`) with
  a `dev` and a `prod` deployment. Vercel's build command
  (`npx convex deploy --cmd 'npm run build'`) is what pushes `convex/` to prod
  on every deploy — see [DEPLOY.md](DEPLOY.md).

## 2. The core decision: one Convex backend, not two

**Decision: infinileague points at the same Convex deployment infinidraft
uses.** No second Convex project, no schema copy, no separate `authAccounts`
table.

Why this beats two separate deployments:

- The two apps' whole value proposition is sharing data — a league synced in
  infinidraft should be visible to infinileague's waiver/trade tools without
  re-syncing or re-authenticating with ESPN/Sleeper/Yahoo.
- `@convex-dev/auth` ties its JWT signing keys and issuer (`CONVEX_SITE_URL`)
  to one specific deployment. Two deployments means two independent user
  databases by default — sharing logins between them would require either (a)
  configuring one deployment's `auth.config.ts` to trust the other's issuer as
  a custom JWT/OIDC provider (Convex supports this — the `providers` array in
  `auth.config.ts` isn't limited to one entry — but the *other* deployment
  still doesn't know about that user, so you'd need to JIT-provision a mirror
  user record on first sight of the token), or (b) syncing user records
  between two databases some other way. Both are real integration work for a
  benefit — data sharing — that a single shared deployment gives you for free.
- Convex explicitly supports this topology: a backend's generated API can be
  exported as a plain TypeScript file (`npx convex-helpers ts-api-spec`) and
  copied into another repo, so a second frontend doesn't need the `convex/`
  source at all, just the deployment URL and that generated `api.ts`. ([Convex
  Stack: Convex in Multiple
  Repositories](https://stack.convex.dev/multiple-repos))

**What "shared login" means concretely with this decision** (per the "same
account, separate sign-in" call): an infinidraft account's email+password
works unmodified on infinileague.com, because it's the same `authAccounts`
row in the same database — no separate sign-up. The user still enters
credentials once per domain, because browser storage (`localStorage`, where
`@convex-dev/auth` keeps its tokens) is origin-scoped and infinidraft.com /
infinileague.com are different registrable domains — nothing short of a
custom cross-domain redirect handoff (an OAuth-style "authorization code"
bridge through a shared backend endpoint) gets you silent SSO across two
truly separate domains, and that was explicitly deferred as unneeded scope
for now. If that ever becomes worth building, it slots in later without
touching the shared-backend decision — it would use the exact same
`convex/http.ts` endpoint pattern infinidraft already uses for other server
routes, and doesn't require moving off a shared deployment.

**Billing follows the same logic**: since `subscriptions` is keyed by
`userId` in the one shared database, a user who's Pro in infinidraft is
automatically Pro in infinileague — `hasProAccess()` just gets called from
infinileague's functions too, no new Stripe product, no second webhook
handler, no entitlement duplication (per the "same subscription covers both"
call).

## 3. Repo topology (per the "keep convex/ in infinidraft" call)

infinidraft's repo remains the one source of truth for the shared Convex
deployment, for now:

- infinileague-specific backend code (waiver rankings queries, trade analyzer
  functions, whatever else) gets added into infinidraft's `convex/` — e.g.
  `convex/waivers/`, `convex/trades/` — alongside the existing `convex/season/`
  module it'll build on. It ships to the *same* prod deployment
  (`patient-squirrel-503`) the next time infinidraft's Vercel build runs
  `convex deploy`.
- The new `infinileague/` repo is a pure frontend: Vite + React + TanStack
  Router + Mantine, matching infinidraft's stack so components/hooks/patterns
  transfer directly. It does **not** get its own `convex/` folder.
- infinileague's frontend gets type-safe access to backend functions via
  `npx convex-helpers ts-api-spec` run against the shared deployment,
  producing an `api.ts` copied into infinileague's repo (regenerated whenever
  infinidraft's backend adds/changes functions infinileague depends on). This
  is the documented pattern for a client repo that doesn't own the backend
  source ([Convex Stack](https://stack.convex.dev/multiple-repos)).
- `infinileague`'s `.env.local` sets `VITE_CONVEX_URL` to the **same** value
  as infinidraft's (dev deployment locally, prod deployment — via its own
  Vercel `CONVEX_DEPLOY_KEY`... except infinileague's Vercel project should
  **not** run `convex deploy` itself, since infinidraft's build already owns
  pushing that deployment's function set. infinileague's Vercel build command
  is a plain `npm run build`, with `VITE_CONVEX_URL` set directly as a Vercel
  env var to the prod deployment's URL — no deploy key needed on that side at
  all.)

**Known cost of deferring the backend extraction**: infinidraft's repo/deploy
pipeline is the single point pushing the shared deployment's function set —
fine solo, but it means only *that* repo should ever run `convex deploy`
against it. Revisit extracting `convex/` into its own repo (the more
decoupled long-term shape — see the alternative that was passed on above)
once infinileague's own backend needs stop being small additions and start
wanting independent release cadence.

## 4. What's actually new to build for infinileague

- **Waiver-wire recommendations**: rank available (non-rostered) players by
  rest-of-season value for a synced league/roster — largely `convex/season/
  faabValues.ts`'s value math, minus the FAAB-bid-specific parts, filtered to
  unrostered players.
- **FAAB bid suggestions**: `convex/season/faabValues.ts` already computes
  `suggestedBid` per team when `teamId` is given — needs a UI and likely
  tuning against real bid outcomes (the file's own comments flag
  `FAAB_FALLOFF_EXPONENT` as "pending real bid data to retune").
  **Note**: FAAB math depends on `positions.ts`/`scoring.ts`/`draft/slots.ts`
  — these already live at repo root scope (not under `season/`), so they're
  already positioned to be shared with any new module.
- **Trade analyzer**: new — compare rest-of-season value given up vs.
  received across two rosters, reusing the same value engine
  (`standardValues.ts` + `projectionBlending.ts`) plus roster/need context
  from `season/rosterPlayers.ts`.
- **Frontend**: new `infinileague` Vite app scaffolded from infinidraft's
  `vite.config.ts` / `tsconfig.json` / `eslint.config.js` / router setup,
  swapping in infinileague-specific routes/pages. Shared UI primitives
  (Mantine theme, common components) can be copied initially; consider
  extracting a shared UI package only if duplication actually becomes
  painful — no need to solve that up front.

## 5. Step-by-step plan

1. **Add a minimal infinileague-scoped backend surface to infinidraft's
   `convex/`** — even just a thin `convex/waivers/available.ts` wrapping
   existing value functions — so there's something concrete to generate the
   API spec against.
2. **Generate `api.ts`** via `npx convex-helpers ts-api-spec` from the dev
   deployment; commit it into a new `infinileague/` repo.
3. **Scaffold `infinileague`** (Vite + React + TS strict + TanStack Router +
   Mantine + `convex` client package, no `@convex-dev/auth` server bits since
   auth is server-side and already lives in infinidraft's deployment — the
   client just needs `ConvexAuthProvider`/`ConvexReactClient` pointed at the
   same `VITE_CONVEX_URL`).
4. **Wire sign-in** on infinileague using the same `Password` sign-in flow
   (`@convex-dev/auth/react`'s `useAuthActions().signIn("password", …)`)
   against the shared deployment — verify an infinidraft account can sign in
   here with zero backend changes.
5. **Build waiver rankings UI** against the wrapped query from step 1 for one
   real synced league, to validate the whole path end to end before building
   out FAAB/trade features.
6. **FAAB bid suggestions UI**, then **trade analyzer**, iterating backend
   functions in infinidraft's `convex/` as needed.
7. **Deploy**: new Vercel project for `infinileague`, plain `npm run build`
   (no `convex deploy`), `VITE_CONVEX_URL` set to the shared prod deployment
   URL, domain `infinileague.com`. No new Convex env vars needed for auth —
   it's the same deployment's existing `JWT_PRIVATE_KEY`/`JWKS`/`SITE_URL`
   (note: `SITE_URL` may need to become auth-flow-aware of both origins if
   any auth redirect callback is domain-sensitive — check this specifically
   when wiring sign-in in step 4, since infinidraft's `SITE_URL` is currently
   hardcoded to `https://infinidraft.com` per `DEPLOY.md`).

## 6. Open items to sanity-check while building (not blocking, just flagged)

- `convex/auth.config.ts`'s `SITE_URL` and any Password-provider
  reset-password email links are currently infinidraft-domain-specific —
  confirm nothing in the auth flow silently assumes the request came from
  infinidraft.com when infinileague.com is the caller.
- `convex/genericLeague.ts`'s free-tier generic league is infinidraft-specific
  framing (draft values for a league that hasn't drafted yet) — infinileague
  likely doesn't need this at all, since it only matters once a real league
  with real rosters exists.
- Confirm Convex's per-deployment function-count/bundle-size limits aren't a
  concern as infinileague's functions accumulate in the same deployment as
  infinidraft's (unlikely to matter at this scale, but worth a glance at
  Convex's current limits page before this grows a lot).
