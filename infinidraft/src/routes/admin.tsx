import { createFileRoute } from "@tanstack/react-router";
import { AdminBillingPanel } from "../pages/Admin/AdminBillingPanel";

export const Route = createFileRoute("/admin")({
  component: AdminBillingPanel,
});
