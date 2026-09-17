import { createFileRoute } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import { AdminDataPanel } from "@shared/AdminDataPanel";
import { AppHeader } from "../components/AppHeader";
import { PageContainer } from "@shared/PageContainer";

export const Route = createFileRoute("/admin-data")({
  component: AdminDataPage,
});

function AdminDataPage() {
  return (
    <PageContainer>
      <Stack gap="lg">
        <AppHeader />
        <AdminDataPanel />
      </Stack>
    </PageContainer>
  );
}
