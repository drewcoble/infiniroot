import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Alert,
  Anchor,
  Card,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { Sparkles } from "lucide-react";
import { api } from "@infinidata/api";
import type { Id } from "@infinidata/dataModel";
import type { ScoringConfig } from "../../../types";
import { UpgradePrompt } from "../../../components/UpgradePrompt";

interface AiInsightsCardProps {
  seasonId: Id<"seasons"> | undefined;
  week: string;
  scoringConfig: ScoringConfig;
}

// Pre-draft AI Insights - a Gemini-written strategy briefing (auction: our $
// value vs. market by position/tier; snake/linear: our rank vs. ADP by
// position/tier - see convex/gemini/preDraftInsights.ts - plus value-gap
// counts and keeper-driven scarcity either way) sitting above the pre-draft
// player table (see PlayersTable.tsx). Pro-only: a
// free-tier caller never sees any of this - convex/draft/insights.ts's
// getPreDraftInsights returns "requires_upgrade" with no insight data at all
// in that case. Only ever rendered for the season's own owner - the pre-
// draft page itself is already owner-only (unlike the shareable Report Card
// link), and getPreDraftInsights enforces that server-side too - so there's
// no separate "viewer" state to design for here.
export function AiInsightsCard({
  seasonId,
  week,
  scoringConfig,
}: AiInsightsCardProps) {
  const report = useQuery(
    api.infinidraft.draft.insights.getPreDraftInsights,
    seasonId ? { seasonId, week, scoringConfig } : "skip",
  );
  // Only needed for the upgrade-prompt copy below (the actual insight
  // headlines/body text are already fully $-vs-ADP aware server-side, per
  // convex/gemini/preDraftInsights.ts) - same `settings.draftType` pattern
  // AUCTION.md/SNAKE.md document every frontend file uses.
  const settings = useQuery(
    api.leagues.getSeasonPublic,
    seasonId ? { seasonId } : "skip",
  );
  const isAuction = (settings?.draftType ?? "auction") === "auction";

  const ensureGenerated = useMutation(
    api.infinidraft.draft.insights.ensureInsightsGenerated,
  );
  const regenerate = useMutation(api.infinidraft.draft.insights.regenerateInsights);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [upgradeModalOpened, setUpgradeModalOpened] = useState(false);

  // Fires once per (season, week, scoring) combo whenever there's no cached
  // row yet - same "auto-backfill on view" pattern as DraftReportCard.tsx's
  // requestedSummaryRef. The mutation itself is a no-op if generation is
  // already underway/cached, so re-running this on remount is safe.
  const requestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!seasonId || report?.status !== "ok" || report.data !== null) return;
    const key = `${seasonId}:${week}:${scoringConfig.scoring}`;
    if (requestedRef.current === key) return;
    requestedRef.current = key;
    void ensureGenerated({ seasonId, week, scoringConfig });
  }, [seasonId, week, scoringConfig, report, ensureGenerated]);

  const handleRegenerate = async () => {
    if (!seasonId) return;
    setIsRegenerating(true);
    try {
      await regenerate({ seasonId, week, scoringConfig });
    } finally {
      setIsRegenerating(false);
    }
  };

  if (!seasonId || report === undefined) return null;

  if (report.status === "requires_upgrade") {
    return (
      <>
        <Card withBorder padding="md">
          <Stack gap="sm">
            <Group gap={6}>
              <Sparkles size={18} />
              <Title order={4}>AI Insights</Title>
            </Group>
            <Anchor size="sm" onClick={() => setUpgradeModalOpened(true)}>
              Go Pro for AI insights
            </Anchor>
          </Stack>
        </Card>
        <Modal
          opened={upgradeModalOpened}
          onClose={() => setUpgradeModalOpened(false)}
          title="AI Insights is a Pro feature"
        >
          <UpgradePrompt
            bare
            message={
              isAuction
                ? "Get an AI-written briefing on where your league's $ values diverge from the market and how your keepers should shape draft-day strategy."
                : "Get an AI-written briefing on where your league's rankings diverge from ADP and how your keepers should shape draft-day strategy."
            }
          />
        </Modal>
      </>
    );
  }

  if (report.data === null) {
    return (
      <Card withBorder padding="md">
        <Group gap="xs">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Generating AI insights…
          </Text>
        </Group>
      </Card>
    );
  }

  return (
    <Card withBorder padding="md">
      <Stack gap="sm">
        <Group gap={6}>
          <Sparkles size={18} />
          <Title order={4}>AI Insights</Title>
        </Group>
        {report.isStale && (
          <Alert
            variant="light"
            color="yellow"
            title="These insights may be outdated"
          >
            <Group justify="space-between" wrap="wrap" gap="xs">
              <Text size="sm">
                Your league settings, scoring, or keepers have changed since
                these were generated.
              </Text>
              <Anchor
                size="sm"
                onClick={handleRegenerate}
                style={{ pointerEvents: isRegenerating ? "none" : undefined }}
              >
                {isRegenerating ? "Refreshing…" : "Refresh"}
              </Anchor>
            </Group>
          </Alert>
        )}
        <Stack gap="xs">
          {report.data.insights.map((insight, index) => (
            <div key={index}>
              <Text size="sm" fw={700}>
                {insight.headline}
              </Text>
              <Text size="sm">{insight.body}</Text>
            </div>
          ))}
        </Stack>
        {!report.isStale && (
          <Group gap={6}>
            <Text size="xs" c="dimmed">
              AI-written insights
            </Text>
            <Anchor
              size="xs"
              c="dimmed"
              onClick={handleRegenerate}
              style={{ pointerEvents: isRegenerating ? "none" : undefined }}
            >
              {isRegenerating ? "Regenerating…" : "Regenerate"}
            </Anchor>
          </Group>
        )}
      </Stack>
    </Card>
  );
}
