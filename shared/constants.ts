// Extracted from infinidraft's src/constants/general.ts - just the two
// constants PageContainer/AppHeader/SignedOutHeader need in both apps.
// Everything else in that file (WEEK, the various mobile-chrome heights,
// STEPPER_BUTTON_SIZE, etc.) is draft-specific and stays local to
// infinidraft.

// Max-width for the app's main content Container - wider than Mantine's
// built-in "lg" (1140px) since these pages are dense with tables/cards
// meant to be scanned at a glance, not read like prose. Sized for a
// ~1680px-wide window, not full bleed, so it still reads as a centered
// page on wider displays.
export const APP_CONTENT_MAX_WIDTH = 1600;

// AppHeader is fixed to the top of the viewport below the "sm" breakpoint
// instead of scrolling with the page. Every mobile layout that renders it
// needs to reserve this much top padding so page content doesn't start out
// hidden underneath it.
//
// Matches AppHeader's actual rendered height on mobile exactly: the 40px
// overflow-menu ActionIcon (the tallest thing in the bar - AppLogo's own
// mobile mark is only ~34px) plus 6px top/bottom padding plus the 1px
// border-bottom (40 + 6 + 6 + 1 = 53). Previously 85, sized for when
// AppLogo's mobile mark was the full 60px desktop logo (see AppLogo.tsx's
// history) - now that it's a compact stacked mark, the fixed `h` this feeds
// needs to shrink to match or it just leaves dead space centered around a
// much smaller logo. AppHeader sets this as a fixed `h` rather than a `mih`
// specifically so it can't silently drift past this value again and get
// tucked under by anything docked below it.
export const MOBILE_HEADER_HEIGHT = 53;
