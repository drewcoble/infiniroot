import { Flex, Image, Text } from "@mantine/core";
import logo from "./infini_logo.png";

interface AppLogoProps {
  // "draft" for infinidraft, "league" for infinileague - the shared icon
  // has no product name baked into it (just the infinity/football-laces
  // mark), only the wordmark differs per app.
  wordmark: string;
}

// The logo + wordmark, shared between both apps' AppHeader/SignedOutHeader
// (and infinidraft's public report-card page) so they don't drift.
//
// One element tree with responsive props throughout (Flex's own direction,
// Image's h, the wordmark Text's fz/c), rather than two parallel hiddenFrom/
// visibleFrom-gated trees - a previous version of this component rendered a
// whole separate mobile Stack + desktop Group side by side, and if the
// breakpoint toggle ever failed to fully hide one of them (a stale deploy
// caught mid-cache-bust did exactly this), both rendered on top of each
// other: a full-size unconstrained logo blown out over the page. A single
// tree can't get into that state - worst case a responsive prop just doesn't
// swap, not two full logos stacking.
//
// Desktop (sm+): logo beside "infini" + wordmark, side by side. Below "sm"
// there's rarely room for that next to whatever else the header needs
// (league picker, mode-switch, ...), so it collapses to the logo stacked
// above just the wordmark's suffix (the "infini" prefix hides) in small
// burlywood letters - still legible as a brand mark, just compact.
export function AppLogo({ wordmark }: AppLogoProps) {
  return (
    <Flex
      direction={{ base: "column", sm: "row" }}
      align="center"
      gap={{ base: 0, sm: "sm" }}
      wrap="nowrap"
      style={{ minWidth: 0, flexShrink: 0 }}
    >
      <Image
        src={logo}
        alt={`infini${wordmark}`}
        h={{ base: 34, sm: 60 }}
        w="auto"
        fit="contain"
      />
      <Text fw={700} lh={1.2} fz={{ base: 10, sm: "1.625rem" }}>
        <Text component="span" inherit c="saddlebrown.7" hiddenFrom="sm">
          infini
        </Text>
        <Text
          component="span"
          inherit
          c={{ base: "burlywood.6", sm: "var(--mantine-color-text)" }}
        >
          {wordmark}
        </Text>
      </Text>
    </Flex>
  );
}
