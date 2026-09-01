import { Group, Image, Text, Title } from "@mantine/core";
import logo from "./infini_logo.png";

interface AppLogoProps {
  // "draft" for infinidraft, "league" for infinileague - the shared icon
  // has no product name baked into it (just the infinity/football-laces
  // mark), only the wordmark differs per app.
  wordmark: string;
  // Keeps the wordmark visible below "sm" too - defaults to true (matching
  // infinileague's simpler usage, which never had a competing element to
  // make room for). infinidraft's own call sites all pass this explicitly
  // (AppHeader hides it below "sm" outside its dashboard mode, to make room
  // for the league picker/mode-switch button), so the default only matters
  // for future callers that don't care either way.
  wordmarkAlwaysVisible?: boolean;
}

// The logo + wordmark, shared between both apps' AppHeader/SignedOutHeader
// (and infinidraft's public report-card page) so they don't drift.
export function AppLogo({ wordmark, wordmarkAlwaysVisible = true }: AppLogoProps) {
  return (
    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
      <Image src={logo} alt={`infini${wordmark}`} h={60} w="auto" />
      <Title
        order={2}
        c="var(--mantine-color-text)"
        // Same size on mobile as desktop, to match the 60px logo's visual
        // weight.
        fz="1.625rem"
        {...(wordmarkAlwaysVisible ? {} : { visibleFrom: "sm" })}
      >
        <Text component="span" inherit c="saddlebrown.7">
          infini
        </Text>
        {wordmark}
      </Title>
    </Group>
  );
}
