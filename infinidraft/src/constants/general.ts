// The Sleeper "week" identifier used for the single season-long draft-prep
// dataset (projections, rankings, draft values) - not an actual NFL week,
// but numbered "0" (rather than a non-numeric sentinel like the old
// "draft") so it sorts/compares naturally alongside real weeks "1"-"18"
// (see playerPoints/playerSeasonStats).
export const WEEK = "0";

// APP_CONTENT_MAX_WIDTH, MOBILE_HEADER_HEIGHT, and POSITION_FILTER_BAR_HEIGHT
// moved to @shared/constants (both apps need them) - import from there now.

// Height of the condensed budget-stats row the Draft Room layout docks
// directly under the fixed AppHeader on mobile (see DraftTopBar.tsx /
// MobileNomination.tsx) - added on top of MOBILE_HEADER_HEIGHT when
// reserving top padding on that route specifically.
export const MOBILE_STATS_ROW_HEIGHT = 40;

// Height of the "$X unallocated" bar the Setup app's pre-draft Budget tab
// docks directly under the fixed AppHeader on mobile (see
// BudgetTab/UnallocatedBar.tsx) - unlike MOBILE_STATS_ROW_HEIGHT this isn't
// reserved at the layout level, since it's specific to one Setup tab rather
// than persistent across all of them; BudgetTab reserves it itself with a
// same-height spacer right before its content.
export const BUDGET_UNALLOCATED_BAR_HEIGHT = 44;

// BOTTOM_NAV_BOTTOM_OFFSET and BOTTOM_NAV_HEIGHT moved to @shared/constants
// (BottomNav.tsx itself lives there now, and all three apps' bars/anchored
// FABs/sheets use the same values) - import from there now.

// The +/- tap target size used by the Budget tab's per-slot $ stepper
// (SlotRow.tsx) and the Draft Room's live bid stepper
// (MobileNomination.tsx's AssignDrawerBody) - both hand-picked this
// exact ActionIcon size already. @shared/NumberStepper.tsx's
// CountStepper/EditableNumberStepper (moved there so infinifaab could reuse
// them - it has its own local copy of this same 40 literal, see that file's
// comment) use this too instead of their own much smaller default, so every
// +/- control in the app (roster slot counts, keeper years, etc.) gets the
// same comfortable tap target on mobile, not just the Budget/nomination
// ones that happened to be tuned by hand already.
export const STEPPER_BUTTON_SIZE = 40;
