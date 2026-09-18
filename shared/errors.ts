import { ConvexError } from "convex/values";

// Matches the "Uncaught Error: <message>" line inside Convex's server-error
// wrapper (the client-side error.message for a plain `throw new Error(...)`
// in a Convex function is the WHOLE wrapped block - request id, "Server
// Error", this line, then a stack trace - not just the message that was
// thrown). Not a documented/stable format, but consistent enough in
// practice to extract from; if it ever stops matching, callers just fall
// back to the generic message below instead of showing something wrong.
const UNCAUGHT_ERROR_PATTERN = /Uncaught (?:Error:\s*)?(.+?)(?:\n|$)/;

function looksWrapped(message: string): boolean {
  return (
    message.includes("Server Error") ||
    message.includes("Request ID") ||
    message.includes("\n")
  );
}

// Every `catch` around a useMutation/useAction call in this app should
// route through this instead of inlining `error instanceof Error ?
// error.message : fallback` - that pattern shows Convex's raw wrapped
// server-error text (stack trace and all) to the user whenever the backend
// throws a plain Error, which is nearly everywhere today (see convex/'s
// throw new Error(...) call sites - ConvexError isn't used server-side
// yet). This never returns raw wrapped text: a short, already-clean
// message (no wrapper markers) passes through as-is, a wrapped one gets
// its inner message extracted, and anything that doesn't clearly parse
// falls back to the caller-supplied generic message.
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : fallback;
  }

  if (!(error instanceof Error)) {
    return fallback;
  }

  const { message } = error;
  if (!looksWrapped(message)) {
    return message;
  }

  const extracted = message.match(UNCAUGHT_ERROR_PATTERN)?.[1]?.trim();
  if (extracted && extracted.length > 0 && extracted.length < 300) {
    return extracted;
  }

  return fallback;
}

// Cross-browser signatures for "a code-split JS chunk failed to load,
// almost always because a new deploy replaced the build this tab's already-
// loaded index.html still points at." Each browser reports it differently -
// a stale SPA-fallback rewrite (serving index.html for a 404'd chunk path)
// turns it into exactly the MIME-type mismatch below rather than a clean
// 404, which is the one RouteErrorFallback.tsx's screenshot-driven bug
// report actually showed, but the others are the same failure mode.
const STALE_CHUNK_ERROR_PATTERNS = [
  "is not a valid javascript mime type",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return STALE_CHUNK_ERROR_PATTERNS.some((pattern) => lower.includes(pattern));
}

// Guards against a reload loop: if the chunk is somehow STILL stale right
// after a reload (e.g. a CDN edge that hasn't caught up yet), this refuses
// to reload again within the cooldown rather than bouncing the tab forever -
// callers should fall through to their normal error UI when this returns
// false instead of assuming the reload always happens.
const STALE_CHUNK_RELOAD_KEY = "staleChunkReloadedAt";
const STALE_CHUNK_RELOAD_COOLDOWN_MS = 10_000;

export function reloadForStaleChunk(): boolean {
  const lastReload = Number(window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY) ?? 0);
  if (Date.now() - lastReload < STALE_CHUNK_RELOAD_COOLDOWN_MS) {
    return false;
  }
  window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
  window.location.reload();
  return true;
}

// Vite wraps every dynamically-imported code-split chunk (TanStack
// Router's own route lazy-loading included) with its own module-preload
// polyfill, which emits this event on `window` instead of just letting the
// rejection propagate silently to whatever awaited the import - catching it
// here means a stale chunk is handled before React/the router even see it,
// rather than only as a fallback once it's already reached an error
// boundary. Call once at app boot (see each app's main.tsx).
// https://vite.dev/guide/build.html#load-error-handling
export function installStaleChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    // Only suppress the rejection (which would otherwise propagate to
    // whatever awaited the failed import, e.g. the router's own error
    // boundary) if a reload is actually happening - preventDefault()
    // unconditionally here would silently swallow the error on a cooldown-
    // blocked reload attempt, leaving the tab stuck with no reload AND no
    // visible error at all.
    if (reloadForStaleChunk()) {
      event.preventDefault();
    }
  });
}
