# infinileague

In-season companion to [infinidraft](https://infinidraft.com): waiver-wire
recommendations, FAAB bid suggestions, and trade analysis, built from the
same league-sync and player-valuation data.

## Stack

Same as infinidraft: React + Vite + TanStack Router (strict TypeScript),
Mantine, Convex (`@convex-dev/auth` for sign-in), deployed as a static SPA.

**This repo has no `convex/` folder.** infinileague talks to the *same*
Convex deployment infinidraft uses instead of standing up its own - same
users, same leagues, same login. See `INFINILEAGUE.md` in the infinidraft
repo for the full reasoning, and `src/main.tsx` / `src/routes/__root.tsx`
here for how that plays out client-side. Backend functions this app needs
live in infinidraft's `convex/` and get consumed here via a generated
`api.ts` (`npx convex-helpers ts-api-spec`, run from infinidraft) - not
present yet, since nothing here calls a Convex function beyond sign-in.

## Setup

```bash
npm install
cp .env.local.example .env.local
```

Set `VITE_CONVEX_URL` in `.env.local` to infinidraft's dev deployment URL
(from infinidraft's own `.env.local`, or `npx convex dev` output there).

```bash
npm run dev
```

Signing in/up here uses the exact same account as infinidraft - an
infinidraft account works here with no separate sign-up, and vice versa.
