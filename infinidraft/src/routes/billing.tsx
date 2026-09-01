import { createFileRoute } from "@tanstack/react-router";
import { BillingPage } from "../pages/Billing/BillingPage";

export const Route = createFileRoute("/billing")({
  component: BillingPage,
});
