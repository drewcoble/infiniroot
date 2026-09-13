import {
  alpha,
  createTheme,
  defaultVariantColorsResolver,
  getPrimaryShade,
  parseThemeColor,
  type CSSVariablesResolver,
  type VariantColorsResolver,
} from "@mantine/core";
import {
  bn,
  burlywood,
  darkSurfaces,
  DEFAULT_RADIUS,
  dst,
  flex,
  gold,
  green,
  indigo,
  ink,
  k,
  paper,
  PRIMARY_COLOR_NAME,
  qb,
  rb,
  red,
  saddlebrown,
  sleeper,
  superflex,
  te,
  wr,
  yahoo,
} from "@shared-core/colors";

// Position/status badges (QB/RB/WR/..., HOLD/WAIT, target/avoid tags, etc.)
// all use variant="light" with a plain color name and no explicit shade
// (e.g. color="qb", not color="qb.8") - Mantine's default shade for that
// case in light mode (theme.primaryShade's light value, 6) reads too pale
// against this app's light backgrounds. Bumps it 2 shades darker in light
// mode only, via light-dark() so dark mode falls through to Mantine's own
// unmodified result untouched. Leaves every other variant (filled,
// outline, etc.) and any call site that already passes an explicit shade
// alone.
const LIGHT_VARIANT_SHADE_BUMP = 2;

const variantColorResolver: VariantColorsResolver = (input) => {
  const defaultResult = defaultVariantColorsResolver(input);
  const parsed = parseThemeColor({ color: input.color, theme: input.theme });
  const colorTuple = parsed.isThemeColor
    ? input.theme.colors[parsed.color]
    : undefined;
  if (input.variant !== "light" || !colorTuple || parsed.shade !== undefined) {
    return defaultResult;
  }

  const lightShade = Math.min(
    getPrimaryShade(input.theme, "light") + LIGHT_VARIANT_SHADE_BUMP,
    9,
  );
  // Safe - lightShade is always 0-9, same range colorTuple is guaranteed
  // to have a value for (see MantineColorsTuple).
  const baseHex = colorTuple[lightShade]!;

  return {
    ...defaultResult,
    background: `light-dark(${alpha(baseHex, 0.15)}, ${defaultResult.background})`,
    hover: `light-dark(${alpha(baseHex, 0.18)}, ${defaultResult.hover})`,
    color: `light-dark(var(--mantine-color-${parsed.color}-${lightShade}), ${defaultResult.color})`,
  };
};

export const theme = createTheme({
  variantColorResolver,
  fontFamily: "Inter, sans-serif",
  fontFamilyMonospace: "IBM Plex Mono, monospace",
  headings: {
    fontFamily: "Space Grotesk, sans-serif",
  },
  // Paper is the light-mode surface; ink rides along as the light-mode text
  // color via Mantine's --mantine-color-black variable.
  white: paper,
  black: ink,
  colors: {
    saddlebrown,
    burlywood,
    indigo,
    gold,
    green,
    red,
    qb,
    superflex,
    rb,
    flex,
    wr,
    te,
    k,
    dst,
    bn,
    sleeper,
    yahoo,
    // See colors.ts's darkSurfaces comment for why this is a partial
    // (shades 6-9 only) override rather than a full palette.
    dark: darkSurfaces,
  },
  primaryColor: PRIMARY_COLOR_NAME,
  // See colors.ts's DEFAULT_RADIUS comment.
  defaultRadius: DEFAULT_RADIUS,
  components: {
    Card: {
      defaultProps: {
        // Explicit even though it now matches defaultRadius, so Card's
        // radius doesn't silently drift if the app-wide default ever
        // changes again.
        radius: "12px",
        shadow: "sm",
      },
    },
    // Badges (position tags, injury status, K/keeper tags, league status,
    // etc.) are always short fixed-vocabulary text (QB, WR, K3, Drafting...)
    // that should never lose characters to an ellipsis - but Mantine's own
    // Badge CSS sets overflow: hidden + text-overflow: ellipsis on both its
    // root and label by default. flexShrink: 0 alone (the original fix
    // here) only stops a badge from shrinking when it's a flex child (e.g.
    // inside a Group) - it does nothing for a badge sitting directly in a
    // plain block/table context, like a <Table.Td>. There, the *browser's*
    // table auto-layout algorithm is the one doing the shrinking: its
    // min-content calculation for a column doesn't count overflow-hidden
    // text as contributing to that column's minimum width, so the table
    // felt free to size a badge's column below what its text actually
    // needs. A 1-2 character badge ("Q", "WR") fit by accident; 3+
    // character ones ("PUP") didn't - and the fix ping-ponged between
    // columns when patched one <Table.Th> min-width at a time (see this
    // file's git history). Overflow: visible removes the root cause
    // instead - every badge always renders at its full content width
    // everywhere, flex or table, with other siblings shrinking/wrapping
    // around it rather than the badge itself ever clipping.
    Badge: {
      styles: {
        root: {
          flexShrink: 0,
          overflow: "visible",
        },
        label: {
          overflow: "visible",
          textOverflow: "clip",
        },
      },
    },
    // Same frosted-glass treatment as BottomNav.tsx's floating pill - dark
    // mode matches var(--mantine-color-dark-5) (one shade lighter than
    // Card's dark-6 "soft surface"), translucent + blurred rather than a
    // flat cutout, so every Popover in the app (SlotRow's closest-players
    // list, PlayerBar's detail card, MobileNomination's nominate search)
    // reads as the same elevated floating surface as the bottom nav bar.
    // Light mode gets a plain light gray instead of gray-1's dark-tinted
    // counterpart - dark-5 is a fixed shade from the dark palette (see the
    // dark: [...] array above), not something that flips with color scheme
    // on its own, so without this light mode would render the same
    // dark-green surface as dark mode.
    Popover: {
      styles: {
        dropdown: {
          backgroundColor:
            "light-dark(color-mix(in srgb, var(--mantine-color-gray-1) 65%, transparent), color-mix(in srgb, var(--mantine-color-dark-5) 50%, transparent))",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        },
      },
    },
    // Anchor defaults to primaryColor's "filled" shade (8 in dark mode,
    // Mantine's default primaryShade.dark) - reads too dark/saturated as
    // burlywood link text against the app's dark background (these are
    // player-name links throughout every table). Pinned to the lighter,
    // truer-to-the-named-color shade 3 in dark mode, independent of
    // primaryColor's shade elsewhere (BottomNav's active-tab color, etc.
    // are untouched by this) - but that same light shade 3 is nearly
    // unreadable in light mode (light text on theme.white's light cream),
    // so light mode gets a darker shade 7 instead via light-dark().
    Anchor: {
      defaultProps: {
        c: "light-dark(var(--mantine-color-burlywood-7), var(--mantine-color-burlywood-3))",
        // These same player-name links are almost always `component="button"`
        // (a real <button>, needed for onClick-to-open-detail rather than
        // navigation) - browsers default a <button>'s text to
        // text-align: center, invisibly so for a single-line name, but
        // clearly wrong the moment a long one wraps to two lines (e.g. in
        // a narrow table column): both lines center within the button's
        // own box instead of staying flush left like every other row.
        // Left is also just correct for the plain <a> case Anchor
        // otherwise renders, so this is safe as a blanket default.
        ta: "left",
      },
    },
    // Buttons default to saddlebrown rather than primaryColor (burlywood) -
    // a default-color Button (no explicit `color` prop) still comes up
    // constantly (e.g. "Sign out", "Back to Setup" on desktop) alongside
    // the many Buttons that already set an explicit color (gold, red, etc),
    // and saddlebrown reads better there than burlywood's filled shade.
    Button: {
      defaultProps: {
        color: "saddlebrown",
        // Mantine's own default ("sm", 36px) is just under the ~40px
        // minimum comfortable tap target - "md" (42px) clears it without
        // an explicit size prop needed at every call site.
        size: "md",
      },
    },
    // Mantine's own default ("md", 28px) is well under the ~40px minimum
    // comfortable tap target - individual call sites already pass an
    // explicit size where one made sense, this just raises the floor for
    // any that don't.
    ActionIcon: {
      defaultProps: {
        size: 40,
      },
    },
    // Mantine's default unfilled track (gray-2) is tuned for a plain white
    // canvas - against theme.white's warm cream tint it's nearly invisible
    // (e.g. MyTeamTab's $0-spent category bars, SlotRow's empty slots).
    // Bumped to gray-4 for light mode only; dark mode's dark-4 default
    // (already legible against the near-black body) is untouched.
    Progress: {
      styles: {
        root: {
          backgroundColor:
            "light-dark(var(--mantine-color-gray-4), var(--mantine-color-dark-4))",
        },
      },
    },
    // Every <Table> in the app follows this size by default now (previously
    // font size wasn't set here, so individual tables inherited whatever
    // ambient size happened to be in scope and drifted out of sync with each
    // other) - "sm" matches the size DraftRoom/MyTeamTab's SlotTable reads
    // as. A table can still override with its own `fz` prop if it genuinely
    // needs to differ. striped defaults off now too - every existing call
    // site used to pass `striped` explicitly (an explicit prop always wins
    // over a defaultProp), so those were all stripped out to actually pick
    // this default up instead of silently overriding it back to true.
    Table: {
      defaultProps: {
        fz: "sm",
        striped: false,
      },
    },
    // Mantine's own default Tooltip is inverted relative to the page (light
    // bg in dark mode, dark bg in light mode) - that's the "white bg in dark
    // mode" that got overridden before light mode existed. Now that both
    // schemes are live, match the tooltip to whichever one is active instead
    // of forcing one fixed look: dark surface in dark mode, light surface in
    // light mode. `light-dark()` is a plain CSS function (not a Mantine
    // helper) - it resolves off the `color-scheme` CSS property, which
    // Mantine already sets on the root to match MantineProvider's current
    // color scheme, so no JS/theme-context plumbing is needed here.
    Tooltip: {
      defaultProps: {
        bg: "light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-9))",
        c: "light-dark(var(--mantine-color-dark-9), var(--mantine-color-dark-1))",
      },
    },
    // Mantine's default close button (Modal/Drawer/etc.) is only 28px
    // ("md") - below the ~40px minimum comfortable tap target, and it's the
    // one control every sheet/dialog in the app shares, mobile included.
    CloseButton: {
      defaultProps: {
        size: 40,
      },
    },
    // Mantine's own Modal z-index (--mantine-z-index-modal: 200) sits BELOW
    // this app's own fixed chrome - AppHeader (220), BottomNav (200),
    // DraftTopBar's MobileStatsRow/MobileNomination (210/200),
    // UnallocatedBar (210), PositionFilterBar (205) - so any Modal left at
    // Mantine's default rendered visually underneath the header/nav instead
    // of over them. 400 clears all of that with room to spare, and sits
    // above Mantine's own popover default (300) too, so a Modal opened over
    // an open Popover always wins the stacking order. A specific Modal can
    // still opt back into a lower zIndex (e.g. routes/league/$leagueId/
    // keepers.tsx's Pro-upgrade prompt deliberately sits at 190, below the
    // header, on purpose).
    //
    // centered: true - Mantine's own default aligns a Modal near the top of
    // the viewport, which reads as "off" once every dialog in the app sits
    // well above the fixed header (see zIndex above) with nothing visually
    // anchoring it up there anymore.
    Modal: {
      defaultProps: {
        zIndex: 400,
        centered: true,
      },
    },
  },
});

// Mantine's own light-mode body defaults to var(--mantine-color-white)
// (theme.white, this app's warm cream) - a plain page background, no
// distinct "surface" to pop off of. Dark mode already has that contrast
// for free (body is dark-7, Card/Popover default to the lighter dark-6),
// so this gives light mode the same relationship: body drops to a plain
// gray-2, while Card/Popover's gray-1 default (see the Popover entry
// above) reads as a distinctly lighter surface again. Only --mantine-
// color-body changes - theme.white itself (button text contrast, etc.)
// is untouched.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    "--mantine-color-body": "var(--mantine-color-gray-2)",
  },
  dark: {},
});
