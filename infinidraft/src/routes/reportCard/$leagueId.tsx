import { createFileRoute, Link } from "@tanstack/react-router";
import { Stack } from "@mantine/core";
import type { Id } from "@infinidata/dataModel";
import { DraftReportCard } from "../../pages/DraftReportCard";
import { PageContainer } from "@shared/PageContainer";
import { AppLogo } from "@shared/AppLogo";

// Deliberately NOT nested under any authenticated layout - like
// /board/$leagueId (the TV board), this is a shareable public link (see
// __root.tsx's isPublicRoute exemption) meant to be opened by anyone with
// it, not just the league's owner. Unlike the TV board it's a normal
// scrollable document rather than a full-bleed live display, so it still
// uses the standard PageContainer - just without AppHeader, which assumes
// an authenticated session (league picker, sign out, etc.) that doesn't
// apply to an anonymous visitor. The brand mark (AppLogo) is rendered here
// at the route level rather than inside DraftReportCard.tsx, so it shows
// above every internal state (loading, not-ready, upgrade prompt) for
// free, the same way AppHeader always shows it on every other page.
export const Route = createFileRoute("/reportCard/$leagueId")({
  component: ReportCardRoute,
});

function ReportCardRoute() {
  const { leagueId } = Route.useParams();
  return (
    <PageContainer pt="xl">
      <Stack gap="lg">
        <Link to="/" style={{ textDecoration: "none" }}>
          <AppLogo wordmark="draft" />
        </Link>
        <DraftReportCard seasonId={leagueId as Id<"seasons">} />
      </Stack>
    </PageContainer>
  );
}
