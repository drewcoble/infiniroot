// Build-time flags for integrations not ready to expose in production yet -
// read from Vite env vars (see DEPLOY.md), same convention as
// VITE_SUPER_ADMIN_EMAILS (src/lib/superAdmin.ts). These only ever gate
// which UI entry points render; the underlying Yahoo/Stripe backend code
// and routes stay fully functional everywhere (including prod) so a
// deploy can still reach them directly if needed.
//
// Both default to enabled (true) when unset, so local dev and the
// "develop" Vercel environment (pointing at the dev Convex deployment)
// need nothing set - only prod sets these to "false". See DEPLOY.md for
// the exact Vercel env var to set per environment.
function isEnabled(value: string | undefined): boolean {
  return value !== "false";
}

export const YAHOO_IMPORT_ENABLED = isEnabled(
  import.meta.env.VITE_ENABLE_YAHOO_IMPORT,
);

export const BILLING_LINK_ENABLED = isEnabled(
  import.meta.env.VITE_ENABLE_BILLING_LINK,
);

// Opt-in, not opt-out - the inverse polarity of the two flags above.
// Snake/linear draft support (SNAKE_DRAFT.md) is mid-build and shouldn't be
// choosable in prod even by accident, so this defaults to OFF everywhere
// and only needs to be explicitly turned on (VITE_ENABLE_SNAKE_DRAFT=true)
// in your own .env.local and the "develop" Vercel environment while it's
// being built out. Gates the Draft Type selector in SettingsForm.tsx -
// the one entry point that can ever set a season's draftType away from
// "auction" - so hiding it there makes every downstream snake-specific
// code path (SnakeDraftTab, TeamsPanel's draft-order mode, etc.)
// unreachable in practice, the same "hide the entry point, not every
// consumer" approach the flags above already use. Same as those two, this
// is UI-only - convex/leagues.ts's createLeague mutation itself still
// accepts a non-auction draftType if called directly.
export const SNAKE_DRAFT_ENABLED =
  import.meta.env.VITE_ENABLE_SNAKE_DRAFT === "true";
