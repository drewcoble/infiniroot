import { useState } from "react";
import { Button, Card, Group, Stack, Text, Title } from "@mantine/core";
import { Import } from "lucide-react";
import { ConnectEspnLeague } from "./ConnectEspnLeague";
import { ConnectSleeperLeague } from "./ConnectSleeperLeague";
import { ConnectYahooLeague } from "./ConnectYahooLeague";

export type LeagueProvider = "sleeper" | "yahoo" | "espn";

const PROVIDERS: Array<{
  value: LeagueProvider;
  label: string;
  // Theme color (see shared/theme.ts) - same brand shades infinidraft's
  // LeagueCreateChoice.tsx uses.
  color: string;
}> = [
  { value: "sleeper", label: "Sleeper", color: "sleeper.9" },
  { value: "yahoo", label: "Yahoo", color: "yahoo.8" },
  { value: "espn", label: "ESPN", color: "espn.8" },
];

interface AddLeagueProps {
  // Which app is hosting this flow - only Yahoo's OAuth round trip cares
  // (it redirects back to that app's origin).
  app: "infinileague" | "infinifaab";
  // Skip the provider choice and open this wizard (e.g. a reconnect link).
  initialProvider?: LeagueProvider | undefined;
  onConnected: (seasonId: string) => void;
  onCancel: () => void;
}

// infinileague/infinifaab's single "Add League" entry point: pick a
// provider, then that provider's own connect wizard. A wizard's Back/Cancel
// returns here rather than leaving the flow, so switching providers doesn't
// mean starting over from the dashboard.
export function AddLeague({ app, initialProvider, onConnected, onCancel }: AddLeagueProps) {
  const [provider, setProvider] = useState<LeagueProvider | null>(initialProvider ?? null);
  const backToChoice = () => setProvider(null);

  if (provider === "sleeper") {
    return <ConnectSleeperLeague onConnected={onConnected} onCancel={backToChoice} />;
  }
  if (provider === "yahoo") {
    return (
      <ConnectYahooLeague app={app} onConnected={onConnected} onCancel={backToChoice} />
    );
  }
  if (provider === "espn") {
    return <ConnectEspnLeague onConnected={onConnected} onCancel={backToChoice} />;
  }

  return (
    <Stack gap="md" py="sm" maw={500}>
      <Title order={4}>Add League</Title>
      {PROVIDERS.map(({ value, label, color }) => (
        <Card key={value} padding="md">
          <Group justify="space-between" wrap="nowrap">
            <Text fw={500}>{label}</Text>
            <Button
              leftSection={<Import size={16} />}
              color={color}
              onClick={() => setProvider(value)}
              style={{ flexShrink: 0 }}
            >
              Connect
            </Button>
          </Group>
        </Card>
      ))}
      <Group>
        <Button variant="subtle" onClick={onCancel}>
          Back
        </Button>
      </Group>
    </Stack>
  );
}
