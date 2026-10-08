# Lumen (subset)

Dot-matrix display font by The Lumen Project Authors (Copyright 2026 Font
Studio), from https://podzi.app/fonts/lumen/ - licensed under the SIL Open
Font License 1.1 (see OFL.txt).

This file is a subset of the published `lumen-round-900.ttf` (the bold
round-dot version), cut down to the scoreboard characters only -
`0123456789.,-–—+%` - and converted to WOFF2 (~0.8 KB vs ~130 KB for
the full font). Used for the scoreboard totals and players' actual
points - see `src/index.css`'s `--font-scoreboard` /
`--font-player-points`; any other character falls back to the regular
number font.
