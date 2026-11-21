# infiniyoffs

League-wide playoffs tracker, companion to infinileague and infinifaab:
custom playoff formats (tiers, groups, matchup drafts, seed bonuses, side
brackets), live brackets, matchups, projections, and playoff odds. The
commissioner connects the league and invites members; everyone else reads.

## Stack

Same as infinileague: React + Vite + TanStack Router (strict TypeScript),
Mantine, Convex (`@convex-dev/auth` for sign-in), deployed as a static SPA.

**No `convex/` folder here.** infiniyoffs talks to the same Convex
deployment as the other apps; its backend lives in
`infinidata/convex/infiniyoffs/`. Access goes through
`requireSeasonViewer` (`infinidata/convex/lib/access.ts`): the commissioner
(owner or co-manager) plus anyone with a `leagueTeamMembers` row - the same
per-team invites infinifaab uses, so one link joins both apps.

## Setup

```bash
npm install
cp .env.local.example .env.local   # set VITE_CONVEX_URL
npm run dev                        # port 5053
```

Yahoo leagues need `APP_BASE_URL_INFINIYOFFS` set on the Convex deployment
(see YAHOO.md), the same as the other apps' `APP_BASE_URL_*`.
