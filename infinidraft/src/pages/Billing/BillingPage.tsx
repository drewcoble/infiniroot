import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Center,
  Group,
  List,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api } from "@infinidata/api";
import { AppHeader } from "../../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";
import { PRO_FEATURES } from "../../constants/proFeatures";
import { useProPricing } from "../../hooks/useProPricing";
import { formatProPrice } from "../../lib/formatPrice";
import { getErrorMessage } from "@shared/errors";

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// The app's one paid plan - see convex/schema.ts's subscriptions table and
// src/constants/proFeatures.ts for what this unlocks.
export function BillingPage() {
  const subscription = useQuery(api.billing.queries.getMySubscription);
  const pricing = useProPricing();
  const startCheckout = useAction(api.billing.actions.startCheckout);
  const openBillingPortal = useAction(api.billing.actions.openBillingPortal);
  const reconcileCheckoutSession = useAction(
    api.billing.actions.reconcileCheckoutSession,
  );
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  // Right after a successful Stripe Checkout, reconcile immediately instead
  // of waiting on the webhook - same "read window.location.search once,
  // clear it, react" pattern SeasonSettingsTab.tsx uses for the Yahoo OAuth
  // redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id");
    if (checkout === "success" && sessionId) {
      setIsReconciling(true);
      void reconcileCheckoutSession({ sessionId })
        .catch(() => {
          // The webhook will still catch this shortly - not fatal if the
          // client-side reconcile fails (e.g. a slow Stripe read).
        })
        .finally(() => setIsReconciling(false));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [reconcileCheckoutSession]);

  const handleSubscribe = async () => {
    setError(null);
    setIsRedirecting(true);
    try {
      const { url } = await startCheckout({
        successPath: "/billing",
        cancelPath: "/billing",
      });
      window.location.href = url;
    } catch (err) {
      setError(getErrorMessage(err, "Failed to start checkout."));
      setIsRedirecting(false);
    }
  };

  const handleManage = async () => {
    setError(null);
    setIsRedirecting(true);
    try {
      const { url } = await openBillingPortal({ returnPath: "/billing" });
      window.location.href = url;
    } catch (err) {
      setError(getErrorMessage(err, "Failed to open billing portal."));
      setIsRedirecting(false);
    }
  };

  if (subscription === undefined || isReconciling) {
    return (
      <PageContainer>
        <Stack gap="lg">
          <AppHeader />
          <Center>
            <Loader />
          </Center>
        </Stack>
      </PageContainer>
    );
  }

  const isActive =
    subscription?.comped ||
    subscription?.status === "active" ||
    subscription?.status === "past_due";

  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <Stack gap="lg" maw={480} mx="auto">
          <Group gap="xs">
            <ActionIcon
              component={Link}
              to="/"
              variant="subtle"
              color="gray"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={18} />
            </ActionIcon>
            <Title order={2}>Billing</Title>
          </Group>

          {isActive ? (
            <Card withBorder padding="lg">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Title order={4}>Pro plan</Title>
                  <Badge color="green">Active</Badge>
                </Group>
                {subscription?.comped && (
                  <Text size="sm" c="dimmed">
                    You have complimentary Pro access.
                  </Text>
                )}
                {subscription?.status === "past_due" && (
                  <Text size="sm" c="orange">
                    Your last payment failed - Stripe is retrying automatically.
                    Update your card to avoid losing access.
                  </Text>
                )}
                {subscription?.currentPeriodEnd && (
                  <Text size="sm" c="dimmed">
                    {subscription.cancelAtPeriodEnd ? "Cancels" : "Renews"} on{" "}
                    {formatDate(subscription.currentPeriodEnd)}.
                  </Text>
                )}
                {subscription?.hasStripeCustomer ? (
                  <Button
                    onClick={() => void handleManage()}
                    loading={isRedirecting}
                    variant="light"
                  >
                    Manage subscription
                  </Button>
                ) : subscription?.comped ? (
                  <Stack gap={4}>
                    <Button
                      onClick={() => void handleSubscribe()}
                      loading={isRedirecting}
                      variant="light"
                    >
                      {pricing
                        ? `Pay anyway - ${formatProPrice(pricing)}`
                        : "Pay anyway"}
                    </Button>
                    <Text size="xs" c="dimmed">
                      If you cancel later, you'll keep your complimentary Pro
                      access.
                    </Text>
                  </Stack>
                ) : (
                  <Text size="sm" c="dimmed">
                    Contact support to make changes to your complimentary
                    access.
                  </Text>
                )}
              </Stack>
            </Card>
          ) : (
            <Card withBorder padding="lg">
              <Stack gap="sm">
                <Group justify="space-between" align="flex-end">
                  <Title order={4}>Pro</Title>
                  {pricing && (
                    <Text size="lg" fw={700}>
                      {formatProPrice(pricing)}
                    </Text>
                  )}
                </Group>
                <List size="sm" spacing={4}>
                  {PRO_FEATURES.map((feature) => (
                    <List.Item key={feature}>{feature}</List.Item>
                  ))}
                </List>
                <Button
                  onClick={() => void handleSubscribe()}
                  loading={isRedirecting}
                >
                  {pricing
                    ? `Subscribe - ${formatProPrice(pricing)}`
                    : "Subscribe"}
                </Button>
              </Stack>
            </Card>
          )}

          {error && (
            <Text size="sm" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Stack>
    </PageContainer>
  );
}
