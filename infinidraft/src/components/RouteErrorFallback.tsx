import { useAuthActions } from "@convex-dev/auth/react";
import { Button, Center, Group, Stack, Text, Title } from "@mantine/core";
import { Link, type ErrorComponentProps } from "@tanstack/react-router";
// useConvexAuth from convex/react, not @convex-dev/auth/react - see
// __root.tsx's comment on the same import for why (the latter's
// isAuthenticated doesn't wait for server confirmation).
import { useConvexAuth } from "convex/react";
import { getErrorMessage } from "@shared/errors";

// @convex-dev/auth's React client stores its JWT/refresh token/etc in
// localStorage under these key prefixes (namespaced by a suffix derived
// from the Convex deployment URL - see node_modules/@convex-dev/auth/dist/
// react/client.js's useNamespacedStorage) rather than anywhere signOut()'s
// own server round-trip can be relied on to reach: if that round-trip is
// failing for the same underlying reason the stored token is bad in the
// first place (see handleBackToSignIn below), signOut() never actually
// clears it, and a reload just re-reads the same bad token again -
// reproducing the exact same "must be signed in" failure forever.
const CONVEX_AUTH_STORAGE_PREFIX = "__convexAuth";

function clearStoredConvexAuthTokens() {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith(CONVEX_AUTH_STORAGE_PREFIX)) {
      window.localStorage.removeItem(key);
    }
  }
}

// Wired in as __root.tsx's errorComponent - the one app-wide safety net
// against a blank white screen. Convex's useQuery throws synchronously
// during render when the underlying query errors (e.g. a stale/deleted
// league, an auth check failing mid-session), and with no error boundary
// anywhere that throw used to unmount the entire React tree with nothing
// but a console error. This catches it app-wide; "Try again" re-renders
// the failed subtree in place, "Back to dashboard" is the escape hatch for
// anything that keeps failing on retry.
export function RouteErrorFallback({ error, reset }: ErrorComponentProps) {
  const message = getErrorMessage(error, "Something went wrong.");
  // Unlike `message` above (deliberately scrubbed for end users - see
  // getErrorMessage's comment), this keeps Convex's raw wrapped error.message
  // as-is: request id, "Server Error", and (on this dev deployment) which
  // convex/*.ts function/line actually threw - see errors.ts's own comment
  // on why that's in .message, not .stack (.stack here is just where the
  // *client* JS Error object got constructed - generic Convex-client-
  // internal frames, not anything pointing at which query/mutation this
  // was). Shown collapsed behind "Technical details" so it doesn't clutter
  // the normal view, but expandable for exactly this kind of "which query
  // is actually failing" debugging without needing devtools access.
  const rawDetail = error instanceof Error ? error.message : String(error);
  const { isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();

  // Landing here while NOT authenticated almost always means a stale/
  // invalid token was still sitting in this browser's storage - __root.tsx
  // optimistically renders the authenticated tree off that token before the
  // server has actually validated it, some query (e.g. listSeasons) gets
  // rejected with "must be signed in", and we end up here. Plain "Try
  // again" reruns the exact same query against the exact same bad token and
  // loops right back here - reproducing in a brand new tab too, since the
  // bad token persists across tabs until something explicitly clears it.
  const looksLikeStaleAuth = !isAuthenticated;

  // Deliberately not an automatic useEffect - an earlier version tried
  // signOut() + reset() (an in-place re-render) as soon as this mounted,
  // but reset() can fire before isAuthenticated had actually finished
  // settling, so the same query failed again immediately, remounting this
  // component and re-triggering the effect - a visible flash loop between
  // this screen and the sign-in form instead of settling on either. Manual
  // (one click) means it can only ever run once, never loop on its own.
  //
  // signOut() is still attempted first (properly invalidates the session
  // server-side when it can), but isn't trusted alone - it needs a network
  // round-trip that can fail for the exact reason this screen exists in the
  // first place, silently leaving the bad token in place. Clearing storage
  // directly guarantees the token is actually gone regardless, and the hard
  // reload after throws away the whole in-memory auth/Convex client state
  // and starts completely fresh against it, so there's no in-place render
  // left to race.
  const handleBackToSignIn = () => {
    void (async () => {
      try {
        await signOut();
      } catch {
        // Expected when the stored session is what's broken - see above.
      }
      clearStoredConvexAuthTokens();
      window.location.href = "/";
    })();
  };

  return (
    <Center py="xl">
      <Stack gap="sm" align="center" maw={420} ta="center">
        <Title order={4}>Something went wrong</Title>
        <Text c="dimmed" size="sm">
          {message}
        </Text>
        <Group>
          {looksLikeStaleAuth ? (
            <Button variant="light" onClick={handleBackToSignIn}>
              Back to sign in
            </Button>
          ) : (
            <>
              <Button onClick={reset} variant="light">
                Try again
              </Button>
              <Button component={Link} to="/" variant="default">
                Back to dashboard
              </Button>
            </>
          )}
        </Group>
        <details style={{ width: "100%" }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "var(--mantine-font-size-xs)",
              color: "var(--mantine-color-dimmed)",
            }}
          >
            Technical details
          </summary>
          <Text
            component="pre"
            size="xs"
            c="dimmed"
            ta="left"
            style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
          >
            {rawDetail}
          </Text>
        </details>
      </Stack>
    </Center>
  );
}
