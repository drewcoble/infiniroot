import { createFileRoute } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AdminBillingPanel } from "@shared/AdminBillingPanel";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <AdminBillingPanel />
      </Stack>
    </PageContainer>
  );
}
