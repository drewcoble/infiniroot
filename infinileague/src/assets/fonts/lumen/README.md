# Lumen (subset)

Dot-matrix display font by The Lumen Project Authors (Copyright 2026 Font
Studio), from https://podzi.app/fonts/lumen/ - licensed under the SIL Open
Font License 1.1 (see OFL.txt).

These files are subsets of the published `lumen-round-{400,900}.ttf` files
(the round-dot version), cut down to the scoreboard characters only -
`0123456789.,-–—+%` - and converted to WOFF2 (~0.8 KB each vs ~130 KB for
the full fonts). Used for the scoreboard totals (900) and players' actual
points (400) - see `src/index.css`'s `--font-scoreboard` /
`--font-player-points`; any other character falls back to the regular
number font.
