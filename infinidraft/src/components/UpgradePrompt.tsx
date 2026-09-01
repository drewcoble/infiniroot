import { Button, Card, Center, List, Stack, Text, Title } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { PRO_FEATURES } from "../constants/proFeatures";
import { formatProPrice } from "../lib/formatPrice";
import { useProPricing } from "../hooks/useProPricing";

interface UpgradePromptProps {
  title?: string;
  message?: string;
  // Skips the outer Center + bordered Card and the title line - for callers
  // that already supply their own surrounding chrome (e.g. AiInsightsCard's
  // upgrade Modal, whose own title bar already says why Pro is required).
  bare?: boolean;
}

// Shown wherever a Pro-only feature is gated for a free-plan user (see
// convex/draft/reportCard.ts's "requires_upgrade" status, and the free
// league cap in convex/leagues.ts) instead of an error state. title/message
// stay caller-specific (each gate explains its own "why"), but the price
// and the list of what Pro includes are the same everywhere - see
// src/constants/proFeatures.ts.
export function UpgradePrompt({
  title = "This feature requires Pro",
  message = "Upgrade to unlock this feature.",
  bare = false,
}: UpgradePromptProps) {
  const pricing = useProPricing();

  const content = (
    <Stack gap="sm" align="center">
      {!bare && <Title order={4}>{title}</Title>}
      <Text size="sm" c="dimmed" ta="center">
        {message}
      </Text>
      <List size="sm" spacing={4} w="100%">
        {PRO_FEATURES.map((feature) => (
          <List.Item key={feature}>{feature}</List.Item>
        ))}
      </List>
      <Button component={Link} to="/billing">
        {pricing ? `Upgrade to Pro - ${formatProPrice(pricing)}` : "Upgrade to Pro"}
      </Button>
    </Stack>
  );

  if (bare) return content;

  return (
    <Center py="xl">
      <Card withBorder padding="lg" maw={420}>
        {content}
      </Card>
    </Center>
  );
}
