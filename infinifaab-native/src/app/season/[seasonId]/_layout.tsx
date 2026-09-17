import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { colors } from '@/components/ui';

// Bottom tab shell for a single season - mirrors infinifaab (web)'s
// league/$leagueId/route.tsx tab set (Dashboard/Players/Bids/Results/
// Settings), added one tab per INFINIFAAB_MOBILE_PLAN.md phase instead of
// all five up front. All five are now wired (Phase 4 complete).
//
// NativeTabs (not the JS `Tabs`) renders a real UITabBarController on iOS
// instead of a JS-drawn bar - on iOS 26 that's the floating Liquid Glass
// tab bar automatically, no manual glass/blur work needed. Trade-off: it
// has no header of its own (unlike JS Tabs' per-screen header), so the
// per-tab "Dashboard"/"Results" title bar is gone - the tab bar's own
// labels now carry that context, same as Apple's own iOS 26 apps.
export default function SeasonTabsLayout() {
  return (
    <NativeTabs tintColor={colors.primary}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf="square.grid.2x2" />
        <NativeTabs.Trigger.Label>Dashboard</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="players">
        <NativeTabs.Trigger.Icon sf="person.2" />
        <NativeTabs.Trigger.Label>Players</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="myBids">
        <NativeTabs.Trigger.Icon sf="banknote" />
        <NativeTabs.Trigger.Label>Bids</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="results">
        <NativeTabs.Trigger.Icon sf="tag" />
        <NativeTabs.Trigger.Label>Results</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
