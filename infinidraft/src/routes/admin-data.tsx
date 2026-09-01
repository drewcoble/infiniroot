import { createFileRoute } from "@tanstack/react-router";
import { AdminDataPanel } from "../pages/Admin/AdminDataPanel";

export const Route = createFileRoute("/admin-data")({
  component: AdminDataPanel,
});
