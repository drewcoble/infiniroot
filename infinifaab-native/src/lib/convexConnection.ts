import { createContext, useContext } from 'react';

// Convex's own connectionState() (isWebSocketConnected/connectionRetries) has
// been observed reporting a perfectly healthy connection while a query
// subscription is permanently stuck pending after switching tabs a few
// times - the client-side socket-liveness check doesn't catch this failure
// mode at all, so there's no way to detect or recover from it from inside
// the Convex client itself. This context exposes a manual escape hatch:
// force-recreate the ConvexReactClient (see RootLayout in app/_layout.tsx),
// which the shared Loading component (src/components/ui.tsx) surfaces as a
// "tap to reconnect" affordance once a load has taken suspiciously long.
export const ConvexReconnectContext = createContext<() => void>(() => {});

export function useConvexReconnect(): () => void {
  return useContext(ConvexReconnectContext);
}
