# Fantasy Projections Scraper

Scrapes FantasyPros consensus projections (QB/RB/WR/TE/DST) into a Convex
database, with a strict-TypeScript React + Mantine frontend to browse them.

## Stack

- **Backend / DB:** Convex (schema, queries, mutations, action-based scraper, cron)
- **Frontend:** React + Vite, strict TypeScript
- **Styling:** Mantine (default theme for now, as requested)
- **Scraping:** `cheerio`, run server-side inside a Convex action (Node runtime)

## Setup

```bash
npm install
npx convex dev
```

The first `npx convex dev` run will:
1. Prompt you to log in / create a Convex project
2. Push `convex/schema.ts`, `convex/projections.ts`, `convex/scrape.ts`, `convex/crons.ts`
3. Generate `convex/_generated/` (referenced by the frontend but not checked in)
4. Print your deployment URL

Copy `.env.local.example` to `.env.local` and paste that URL in as `VITE_CONVEX_URL`.

Then, in a second terminal:

```bash
npm run dev
```

## Running the scraper

Convex functions can be called directly from the CLI while `convex dev` is running:

```bash
# One position
npx convex run scrape:scrapePosition '{"position":"QB","week":"draft"}'

# All five positions
npx convex run scrape:scrapeAllPositions '{"week":"draft"}'
```

Once the season starts, switch `week` from `"draft"` to a week number string
(e.g. `"1"`) to pull weekly projections instead — the URL and schema already
support both via the `week` field.

A daily cron (`convex/crons.ts`) is wired up to auto-refresh draft projections;
edit the schedule or swap in weekly scraping once the season kicks off.

## How the scraper works

FantasyPros' projection pages render an HTML table with two header rows for
QB/RB/WR/TE (a grouping row — PASSING / RUSHING / MISC — plus a leaf row with
stat abbreviations like ATT, YDS, TDS), and typically one header row for DST.

`convex/scrape.ts` reads this structurally: it expands the group row across
its `colspan`s so it lines up with the leaf row, builds column keys like
`PASSING_YDS` or `RUSHING_TDS`, then walks `tbody` rows into
`{ playerName, team, stats, fpts }` records.

**Important caveat:** this was written against the page's rendered text
content, not the raw HTML source (I don't have live browser access to inspect
FantasyPros' actual CSS class names). The structural approach — reading by
table position rather than by class — should hold up, but if a scrape run
returns 0 rows, start by checking:

1. Is `table thead tr` actually two rows on the live page? (log `headerRows.length`)
2. Is the player name still inside an `<a>` tag in the first `<td>`?
3. Did FantasyPros serve a bot-check / consent page instead of the real table?
   (log the raw `html` length/first 500 chars to check)

## Data model

Projections are stored generically rather than with per-position typed
columns, since QB/RB/WR/TE/DST each expose different stats:

```ts
{
  position: "QB" | "RB" | "WR" | "TE" | "DST"
  week: string          // "draft" or "1", "2", ...
  playerName: string
  team: string | null
  stats: Record<string, number>  // e.g. { PASSING_YDS: 235.9, RUSHING_TDS: 0.2 }
  fpts: number
  scrapedAt: number
}
```

The frontend derives which stat columns to render per position from whatever
keys are actually present on the first returned row, so QB and DST tables
show different columns automatically.

## Not yet done / next steps

- Mantine is on default styling as requested — no custom theme yet
- No auth/access control on the Convex functions (fine for personal use, add
  before deploying anywhere public)
- No retry/backoff on scrape failures beyond the thrown error
