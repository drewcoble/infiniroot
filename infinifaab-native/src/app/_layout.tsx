import { useCallback, useEffect, useState } from 'react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ConvexReconnectContext } from '@/lib/convexConnection';
import { secureTokenStorage } from '@/lib/secureTokenStorage';

SplashScreen.preventAutoHideAsync();

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    'EXPO_PUBLIC_CONVEX_URL is not set. Copy .env.local.example to .env.local and fill it in ' +
      '(the same Convex deployment URL infinifaab, the web app, uses).',
  );
}

function createConvexClient(): ConvexReactClient {
  return new ConvexReactClient(convexUrl!);
}

export default function RootLayout() {
  // No fonts/auth-state gate before hiding splash yet - the index screen
  // shows its own Loading state while ConvexAuth resolves, same as the
  // web app's AuthPanel returning null while isLoading.
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  // `generation` forces a full remount of ConvexAuthProvider (via `key`)
  // whenever reconnect() is called - see convexConnection.ts for why this
  // manual escape hatch exists at all (Convex's own connectionState() has
  // been observed reporting a healthy connection while a query is
  // permanently stuck, so there's nothing to automatically detect and
  // recover from here).
  const [client, setClient] = useState<ConvexReactClient>(() => createConvexClient());
  const [generation, setGeneration] = useState(0);

  const reconnect = useCallback(() => {
    setClient((previousClient) => {
      // Deferred rather than closed immediately - the old
      // ConvexAuthProvider subtree (about to unmount because `generation`
      // changes below too) still has in-flight effects that touch this
      // client as part of its own teardown. Closing synchronously here
      // raced with that teardown and threw "ConvexReactClient has already
      // been closed" - giving React a tick to finish unmounting first
      // avoids it.
      setTimeout(() => void previousClient.close(), 0);
      return createConvexClient();
    });
    setGeneration((g) => g + 1);
  }, []);

  return (
    // Dark-only navigation theme - matches infinifaab web's
    // defaultColorScheme="dark" default; a light/dark switcher isn't
    // wired up yet (see src/components/ui.tsx).
    <ThemeProvider value={DarkTheme}>
      <ConvexReconnectContext.Provider value={reconnect}>
        {/* key={generation}: remounting on reconnect() ensures every
            descendant's useQuery subscribes fresh against the new client
            instead of holding a stale reference to the old one. No custom
            storageNamespace/replaceURL - infinifaab only configures the
            Password provider (see infinidata/convex/auth.ts), so there's no
            OAuth/magic-link flow whose `?code=`-equivalent deep-link param
            this app would ever legitimately need to handle;
            shouldHandleCode={false} for the same reason infinidraft's
            main.tsx gives (see its own comment) even though the exact
            trigger there - a Vercel SSO wall's `?code=` - doesn't apply on
            native. secureTokenStorage is the expo-secure-store-backed
            TokenStorage (src/lib/secureTokenStorage.ts) - @convex-dev/auth
            has no default storage on React Native the way it does
            localStorage on web, so this is required, not optional. */}
        <ConvexAuthProvider
          key={generation}
          client={client}
          storage={secureTokenStorage}
          shouldHandleCode={false}
        >
          {/* title: '' on the season group - its own Tabs layout
              (src/app/season/[seasonId]/_layout.tsx) renders a per-tab
              header (Dashboard/Results/...), so this outer Stack header is
              kept only for its back button; without the override it shows
              the raw route pattern "season/[seasonId]" as title, stacked
              redundantly above the tab's own header. */}
          <Stack>
            <Stack.Screen name="season/[seasonId]" options={{ title: '' }} />
          </Stack>
        </ConvexAuthProvider>
      </ConvexReconnectContext.Provider>
    </ThemeProvider>
  );
}
