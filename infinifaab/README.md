# infinifaab

Weekly silent-auction free agency bidding, companion to
[infinidraft](https://infinidraft.com) and
[infinileague](https://infinileague.com): invite the real people who run
each team, let them place competing proxy ("max") bids on waiver-eligible
players, and let the commissioner close the auction on a schedule.

## Stack

Same as infinileague: React + Vite + TanStack Router (strict TypeScript),
Mantine, Convex (`@convex-dev/auth` for sign-in), deployed as a static SPA.

**This repo has no `convex/` folder.** infinifaab talks to the *same* Convex
deployment infinidraft/infinileague use - same users, same leagues, same
login, and a league connected from here (via "Connect League") is an
ordinary season row those other apps already know how to read. See
`src/main.tsx` / `src/routes/__root.tsx` for how that plays out client-side.
