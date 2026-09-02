import { Group, Image, Stack, Text, Title } from "@mantine/core";
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
// Desktop (sm+) renders the full mark - logo beside "infini" + wordmark, as
// always. Below "sm" there's rarely room for that next to whatever else the
// header needs (league picker, mode-switch, ...), so rather than hiding the
// wordmark outright it collapses to the logo stacked above just the
// wordmark's suffix (no "infini" prefix) in small burlywood letters - still
// legible as a brand mark, just compact.
export function AppLogo({ wordmark }: AppLogoProps) {
  return (
    <>
      <Stack hiddenFrom="sm" gap={0} align="center" style={{ flexShrink: 0 }}>
        <Image src={logo} alt={`infini${wordmark}`} h={34} w="auto" />
        <Text fz={10} fw={700} lh={1.2} c="burlywood.6">
          {wordmark}
        </Text>
      </Stack>
      <Group
        visibleFrom="sm"
        gap="sm"
        wrap="nowrap"
        style={{ minWidth: 0, flex: 1 }}
      >
        <Image src={logo} alt={`infini${wordmark}`} h={60} w="auto" />
        <Title order={2} c="var(--mantine-color-text)" fz="1.625rem">
          <Text component="span" inherit c="saddlebrown.7">
            infini
          </Text>
          {wordmark}
        </Title>
      </Group>
    </>
  );
}
