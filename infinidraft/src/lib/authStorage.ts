import type { TokenStorage } from "@convex-dev/auth/react";

// Domain to scope the auth session cookie to - e.g. ".infinidraft.com" in
// Production, ".develop.infinidraft.com" for the develop environment (see
// SNAKE_DRAFT.md §5.4). Deliberately per-environment rather than always the
// widest ".infinidraft.com": that would make a develop session also valid
// on infinidraft.com's real subdomains (and vice versa) since Domain-scoped
// cookies match every subdomain underneath the value given, not just the
// exact host - each environment should get its own isolated value, set as
// this Vercel project/environment's own VITE_AUTH_COOKIE_DOMAIN.
//
// Unset (the case for every environment until the www/auction/snake split
// in SNAKE_DRAFT.md §5 actually ships, including local dev, which has no
// subdomains to share a session across in the first place) falls back to
// @convex-dev/auth's own default (localStorage) - see authCookieStorage
// below - with zero behavior change from today.
const COOKIE_DOMAIN = import.meta.env.VITE_AUTH_COOKIE_DOMAIN as
  | string
  | undefined;

// Arbitrary but generous - an expired stored token just forces a fresh
// sign-in, so this isn't load-bearing the way a real session-lifetime
// policy would be. Convex Auth refreshes the underlying JWT well before
// this on its own; this only bounds how long the refresh token itself (the
// thing that survives a browser restart) stays valid client-side.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function readCookie(name: string): string | undefined {
  const prefix = `${name}=`;
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

function writeCookie(name: string, value: string): void {
  document.cookie = [
    `${name}=${encodeURIComponent(value)}`,
    `Domain=${COOKIE_DOMAIN}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    // Same-site (subdomains of one registrable domain, not genuinely
    // cross-site) - Lax is the conventional safe default and covers every
    // navigation this app does (top-level GETs between subdomains).
    "SameSite=Lax",
    // Only ever reached when COOKIE_DOMAIN is set (see authCookieStorage
    // below), which only happens in deployed HTTPS environments - safe to
    // require unconditionally rather than branching on protocol.
    "Secure",
  ].join("; ");
}

function deleteCookie(name: string): void {
  document.cookie = [
    `${name}=`,
    `Domain=${COOKIE_DOMAIN}`,
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}

// Cookie-backed TokenStorage for @convex-dev/auth's ConvexAuthProvider
// (see src/main.tsx), scoped to a shared parent domain instead of the
// library's default localStorage - localStorage is strictly origin-scoped,
// so a session started on www wouldn't be visible after a league click
// navigates (a real cross-origin browser navigation, not client-side
// routing - see SNAKE_DRAFT.md §5.3) to auction./snake.infinidraft.com.
//
// Not a security upgrade over localStorage - a cookie readable by this
// same page's JS (no HttpOnly - the auth client itself needs to read it)
// is equally exposed to XSS as localStorage was. This exists purely to
// make the token visible across subdomains, not to harden it.
//
// undefined (falls back to ConvexAuthProvider's own localStorage default)
// whenever VITE_AUTH_COOKIE_DOMAIN isn't set.
export const authCookieStorage: TokenStorage | undefined = COOKIE_DOMAIN
  ? {
      getItem: readCookie,
      setItem: writeCookie,
      removeItem: deleteCookie,
    }
  : undefined;
