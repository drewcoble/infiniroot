import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { Import, Wrench } from "lucide-react";
import { YAHOO_IMPORT_ENABLED } from "../../../lib/featureFlags";

interface LeagueCreateChoiceProps {
  onChooseCustom: () => void;
  onChooseSleeperImport: () => void;
  onChooseYahooImport: () => void;
}

// First screen of the "+ New League" flow (see LeagueDetails.tsx) - a fork
// between today's blank-form setup and importing settings/teams from a real
// Sleeper or Yahoo league (see LeagueImportWizard.tsx / YahooLeagueImportWizard.tsx).
export function LeagueCreateChoice({
  onChooseCustom,
  onChooseSleeperImport,
  onChooseYahooImport,
}: LeagueCreateChoiceProps) {
  return (
    <Stack gap="md" py="sm" maw={500}>
      <Title order={4}>New League</Title>
      <Card withBorder padding="md">
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={500}>Custom Setup</Text>
          </Stack>
          <Button
            variant="default"
            leftSection={<Wrench size={16} />}
            onClick={onChooseCustom}
            style={{ flexShrink: 0 }}
          >
            Start
          </Button>
        </Group>
      </Card>
      <Card withBorder padding="md">
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={500}>Import from Sleeper</Text>
          </Stack>
          <Button
            leftSection={<Import size={16} />}
            onClick={onChooseSleeperImport}
            color="sleeper.9"
            style={{ flexShrink: 0 }}
          >
            Import
          </Button>
        </Group>
      </Card>
      {YAHOO_IMPORT_ENABLED && (
        <Card withBorder padding="md">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
              <Text fw={500}>Import from Yahoo</Text>
            </Stack>
            <Button
              leftSection={<Import size={16} />}
              onClick={onChooseYahooImport}
              color="yahoo.8"
              style={{ flexShrink: 0 }}
            >
              Import
            </Button>
          </Group>
        </Card>
      )}
    </Stack>
  );
}
