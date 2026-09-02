import { Box, Group } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { MOBILE_HEADER_HEIGHT } from "./constants";
import { AppLogo } from "./AppLogo";

interface SignedOutHeaderProps {
  // "draft" or "league" - see AppLogo's own prop.
  wordmark: string;
}

// Logo-only header for each app's loading/signed-out states. Deliberately
// has zero Convex queries - unlike the real AppHeader, which needs a
// confirmed session - so this can render before/without one. Same
// container styling as AppHeader so the two don't visually jump once auth
// resolves.
export function SignedOutHeader({ wordmark }: SignedOutHeaderProps) {
  return (
    <Box
      pos={{ base: "fixed", sm: "static" }}
      top={0}
      left={0}
      right={0}
      px={{ base: "md", sm: 0 }}
      py={{ base: "sm", sm: "xs" }}
      h={{ base: MOBILE_HEADER_HEIGHT, sm: "auto" }}
      style={{
        zIndex: 220,
        display: "flex",
        alignItems: "center",
        overflow: "hidden",
        background:
          "color-mix(in srgb, var(--mantine-color-body) 75%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Group
        justify="space-between"
        align="center"
        wrap="nowrap"
        gap="xs"
        style={{ flex: 1, minWidth: 0 }}
      >
        <Link to="/" style={{ flexShrink: 0, textDecoration: "none" }}>
          <AppLogo wordmark={wordmark} />
        </Link>
      </Group>
    </Box>
  );
}
