import { Box, Group, Image, Stack, Text, Title } from "@mantine/core";
import logo from "./infini_logo.png";

interface AppLogoProps {
  // "draft" for infinidraft, "league" for infinileague - the shared icon
  // has no product name baked into it (just the infinity/football-laces
  // mark), only the wordmark differs per app.
  wordmark: string;
}

// Raw CSS (not Mantine's h/mah style props, and not a responsive style-prop
// object) for the two logo sizes - a previous version drove sizing/color
// through Mantine's responsive `h={{ base, sm }}` / `c={{ base, sm }}`
// object props on a nested Text-in-Text, and in production that resolved to
// the full desktop wordmark at full size on mobile too, blowing out well
// past the header. hiddenFrom/visibleFrom (plain, non-responsive-object
// props) are the one mechanism already proven to work correctly at this
// breakpoint elsewhere in both apps (BottomNav, the desktop Tabs wrapper),
// so this goes back to that for the mobile/desktop split, plus a hard
// overflow:hidden + explicit max-height on every layer so even a
// misbehaving child can't visually escape the header again.
const MOBILE_LOGO_SIZE = 34;
const DESKTOP_LOGO_SIZE = 60;

// The logo + wordmark, shared between both apps' AppHeader/SignedOutHeader
// (and infinidraft's public report-card page) so they don't drift.
//
// Desktop (sm+): logo beside "infini" + wordmark, side by side, unchanged.
// Below "sm" there's rarely room for that next to whatever else the header
// needs (league picker, mode-switch, ...), so it collapses to the logo
// stacked above just the wordmark's suffix (no "infini" prefix) in small
// burlywood letters - still legible as a brand mark, just compact.
export function AppLogo({ wordmark }: AppLogoProps) {
  return (
    <Box
      style={{
        overflow: "hidden",
        maxHeight: DESKTOP_LOGO_SIZE,
        flexShrink: 0,
      }}
    >
      <Stack
        hiddenFrom="sm"
        gap={0}
        align="center"
        style={{ overflow: "hidden", maxHeight: MOBILE_LOGO_SIZE + 16 }}
      >
        <Image
          src={logo}
          alt={`infini${wordmark}`}
          style={{
            height: MOBILE_LOGO_SIZE,
            maxHeight: MOBILE_LOGO_SIZE,
            width: "auto",
            objectFit: "contain",
          }}
        />
        <Text fz={10} fw={700} lh={1.2} c="burlywood.6">
          {wordmark}
        </Text>
      </Stack>
      <Group
        visibleFrom="sm"
        gap="sm"
        wrap="nowrap"
        align="center"
        style={{ overflow: "hidden", maxHeight: DESKTOP_LOGO_SIZE, minWidth: 0, flex: 1 }}
      >
        <Image
          src={logo}
          alt={`infini${wordmark}`}
          style={{
            height: DESKTOP_LOGO_SIZE,
            maxHeight: DESKTOP_LOGO_SIZE,
            width: "auto",
            objectFit: "contain",
          }}
        />
        <Title order={2} c="var(--mantine-color-text)" fz="1.625rem">
          <Text component="span" inherit c="saddlebrown.7">
            infini
          </Text>
          {wordmark}
        </Title>
      </Group>
    </Box>
  );
}
