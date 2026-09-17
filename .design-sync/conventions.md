## Wrapping and setup

Every screen must be wrapped in this exact provider chain (order matters) or components render unstyled or throw:

```tsx
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { MantineProvider } from "@mantine/core";
import { ConvexReactClient } from "convex/react";
import { theme, cssVariablesResolver } from "@infiniroot/shared";

const convex = new ConvexReactClient(CONVEX_URL);

<ConvexAuthProvider client={convex}>
  <MantineProvider theme={theme} defaultColorScheme="dark" cssVariablesResolver={cssVariablesResolver}>
    {/* your screen */}
  </MantineProvider>
</ConvexAuthProvider>
```

`ConvexAuthProvider` is required even for screens that don't call Convex directly — `AppHeader`, `AuthPanel`, and `ConnectSleeperLeague` all read auth/query state internally and throw outside it. Always pass `defaultColorScheme="dark"` and `cssVariablesResolver` — this product is dark-mode-first; light mode exists but every screen should default dark.

Components that render `<Link>`/use `useNavigate` (`AppHeader`, `BottomNav`, `SignedOutHeader`) need a TanStack Router context too — wrap the screen in a `RouterProvider` with a real route tree so navigation doesn't throw.

## Styling idiom

No CSS classes, no utility-class vocabulary — style through Mantine props and the theme's named colors, or through `var(--mantine-color-*)` custom properties for raw style objects. `primaryColor` is `"burlywood"`; `Button`'s own default color is `"saddlebrown"`. Named theme colors (usable as any Mantine `color`/`c` prop, or as `var(--mantine-color-<name>-<0-9>)`):

| Color | Use |
|---|---|
| `burlywood` | primary actions, links, selected states |
| `saddlebrown` | default button color, secondary accents |
| `qb` / `rb` / `wr` / `te` / `dst` / `k` | position badges/chips — one color per real position (`Position = "QB" \| "RB" \| "WR" \| "TE" \| "DST" \| "K"`) |
| `flex` / `superflex` / `bn` | flex/superflex/bench roster-slot chips |
| `indigo` / `gold` / `green` / `red` | secondary semantic accents |
| `sleeper` / `yahoo` | third-party integration branding (Sleeper/Yahoo import flows) |

Don't invent new colors for positions or roster slots — use `POSITION_COLORS`/`positionColorVar(position, shade)` from `@infiniroot/shared` rather than picking a Mantine color by hand. `defaultRadius` is `12px` (already the default on every Mantine component — don't override radius per-component). Cards use `shadow="sm"`; overlays (`Popover`, `Modal`) use a `blur(16px)` backdrop-filter treatment, already wired via theme `components` overrides — don't re-implement it inline.

## Where the truth lives

- `theme.ts` (bound as the `theme`/`cssVariablesResolver` exports) — the full color palette and per-component default props.
- `positionColors.ts` (`POSITION_COLORS`, `positionColorVar`, `POSITION_ORDER`) — position/roster-slot color mapping, don't duplicate it.
- `constants.ts` — layout constants (`APP_CONTENT_MAX_WIDTH`, `MOBILE_HEADER_HEIGHT`, `BOTTOM_NAV_HEIGHT`, etc.) that fixed-position chrome (`AppHeader`, `BottomNav`, `PositionFilterBar`) depends on for spacing.
- Each component's own `.prompt.md` in this project for its specific composition patterns and prop shapes.

## Idiomatic build snippet

A players list row, using the real component and the theme's position-color idiom for surrounding layout:

```tsx
<PlayerCard
  row={{
    name: "Justin Jefferson",
    team: "MIN",
    position: "WR",
    rosRank: 3,
    positionRank: 2,
    rosPpg: 19.4,
    actualPpg: 17.8,
    rosteredByTeamName: "The Gridiron Gurus",
  }}
  isRookie={false}
/>
```

For layout glue around components like this, prefer Mantine's `Stack`/`Group`/`Box` with theme colors (`c="dimmed"`, `c="burlywood"`) over raw CSS.
