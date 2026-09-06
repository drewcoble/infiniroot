import { AppHeader } from "@infiniroot/shared";
import { PreviewRouter } from "../../shared/previewProviders";
import { Button, Menu, Text } from "@mantine/core";
import { Check, CreditCard, Plus, ShieldCheck } from "lucide-react";

const leagueMenuItems = (
  <>
    <Menu.Item leftSection={<Check size={16} />}>The Gridiron Gurus</Menu.Item>
    <Menu.Item>Dynasty Dominators</Menu.Item>
    <Menu.Divider />
    <Menu.Item leftSection={<Plus size={16} />}>New League</Menu.Item>
  </>
);

export function Default() {
  return (
    <PreviewRouter>
      <AppHeader
        wordmark="draft"
        selectedLeagueLabel="The Gridiron Gurus"
        leagueMenuItems={leagueMenuItems}
      />
    </PreviewRouter>
  );
}

export function WithModeSwitchAndOverflow() {
  return (
    <PreviewRouter>
      <AppHeader
        wordmark="draft"
        selectedLeagueLabel="The Gridiron Gurus"
        leagueMenuItems={leagueMenuItems}
        leagueButtonWidth={{ base: 130, sm: 220 }}
        modeSwitchSlot={
          <Button variant="light" size="sm" color="burlywood">
            <Text visibleFrom="sm" component="span" inherit>
              Back to League
            </Text>
            <Text hiddenFrom="sm" component="span" inherit>
              League
            </Text>
          </Button>
        }
        extraOverflowItems={
          <>
            <Menu.Item leftSection={<CreditCard size={16} />}>Billing</Menu.Item>
            <Menu.Item leftSection={<ShieldCheck size={16} />}>Admin</Menu.Item>
          </>
        }
      />
    </PreviewRouter>
  );
}

export function DashboardHiddenLeagueControls() {
  return (
    <PreviewRouter>
      <AppHeader wordmark="draft" hideLeagueControls />
    </PreviewRouter>
  );
}
