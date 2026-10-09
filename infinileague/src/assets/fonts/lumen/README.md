# Lumen (subset)

Dot-matrix display font by The Lumen Project Authors (Copyright 2026 Font
Studio), from https://podzi.app/fonts/lumen/ - licensed under the SIL Open
Font License 1.1 (see OFL.txt).

This file is a subset of the published `lumen-round-900.ttf` (the bold
round-dot version), cut down to the characters it's used for -
`0123456789.,-–—+%` plus ` :QOTHalf` for live game clocks ("Q3 2:58",
"OT 4:02", "Half") - and converted to WOFF2 (~1 KB vs ~130 KB for the full
font). Used for the scoreboard totals, players' actual points, and live
game clocks - see `src/index.css`'s `--font-scoreboard` /
`--font-player-points`; any other character falls back to the regular
number font.
