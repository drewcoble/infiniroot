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
// Matches AppHeader's actual rendered height on mobile exactly: the 60px
// logo image plus 12px top/bottom padding ("sm" spacing) plus the 1px
// border-bottom (60 + 12 + 12 + 1 = 85). AppHeader sets this as a fixed `h`
// rather than a `mih` specifically so it can't silently drift past this
// value again and get tucked under by anything docked below it.
export const MOBILE_HEADER_HEIGHT = 85;
