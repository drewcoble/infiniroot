// The Sleeper "week" identifier used for the single season-long draft-prep
// dataset (projections, rankings, draft values) - not an actual NFL week,
// but numbered "0" (rather than a non-numeric sentinel like the old
// "draft") so it sorts/compares naturally alongside real weeks "1"-"18"
// (see playerPoints/playerSeasonStats).
export const WEEK = "0";

// APP_CONTENT_MAX_WIDTH and MOBILE_HEADER_HEIGHT moved to @shared/constants
// (both apps need them) - import from there now.

// Height of the condensed budget-stats row the Draft Room layout docks
// directly under the fixed AppHeader on mobile (see DraftTopBar.tsx /
// MobileNomination.tsx) - added on top of MOBILE_HEADER_HEIGHT when
// reserving top padding on that route specifically.
export const MOBILE_STATS_ROW_HEIGHT = 40;

// Height of PositionFilterBar's fixed mobile bar (40px circles + 8px
// vertical padding each side + 1px border). Every mobile caller fixes this
// bar below whatever's already docked at the top (MOBILE_HEADER_HEIGHT,
// plus MOBILE_STATS_ROW_HEIGHT in the Draft Room) and must reserve this much
// space below it as a real spacer element - `<Box hiddenFrom="sm" h={...} />`
// right before the page's content, same as BudgetTab.tsx does for
// BUDGET_UNALLOCATED_BAR_HEIGHT below - NOT as a `pt` style prop on a
// Stack/Box that also sets `py`. Mantine's Box destructures style props in a
// fixed internal order (`py` before `pt` - see extractStyleProps in
// @mantine/core), so `py`'s paddingBlock silently wins over an explicit `pt`
// on the same element regardless of which was written last in JSX; the
// element ends up with far less top padding than intended, and page content
// renders underneath the fixed bar instead of below it. This bit
// InjuryReport.tsx and PlayersTable.tsx (both used `<Stack py="sm" pt={...}>`
// before switching to the spacer-element pattern).
export const POSITION_FILTER_BAR_HEIGHT = 57;

// Height of the "$X unallocated" bar the Setup app's pre-draft Budget tab
// docks directly under the fixed AppHeader on mobile (see
// BudgetTab/UnallocatedBar.tsx) - unlike MOBILE_STATS_ROW_HEIGHT this isn't
// reserved at the layout level, since it's specific to one Setup tab rather
// than persistent across all of them; BudgetTab reserves it itself with a
// same-height spacer right before its content.
export const BUDGET_UNALLOCATED_BAR_HEIGHT = 44;

// Bottom offset for the mobile bottom nav bar (BottomNav.tsx) and everything
// else anchored to the same edge - currently just the nominate FAB in
// MobileNomination.tsx. Kept in one place so they can't drift apart the way
// the FAB briefly did after the nav bar's own offset changed without it.
export const BOTTOM_NAV_BOTTOM_OFFSET = 7;

// Total rendered height of the bottom nav bar's pill: each column is
// py=12 top/bottom around a 20px icon + 2px gap + 10px label, plus the
// pill's own 1px border top and bottom (12 + 20 + 2 + 10 + 12 + 1 + 1).
// The nominate FAB's wrapper Box in MobileNomination.tsx is given this same
// height and centers its 56px circle within it via flexbox, so the FAB's
// vertical center lines up with the bar's by construction instead of by
// two independently-guessed numbers happening to match.
export const BOTTOM_NAV_HEIGHT = 58;

// The +/- tap target size used by the Budget tab's per-slot $ stepper
// (SlotRow.tsx) and the Draft Room's live bid stepper
// (MobileNomination.tsx's AssignDrawerBody) - both hand-picked this
// exact ActionIcon size already. components/NumberStepper.tsx's shared
// CountStepper/EditableNumberStepper now use this too instead of their own
// much smaller default, so every +/- control in the app (roster slot
// counts, keeper years, etc.) gets the same comfortable tap target on
// mobile, not just the Budget/nomination ones that happened to be tuned by
// hand already.
export const STEPPER_BUTTON_SIZE = 40;
