import { Stack } from "@mantine/core";
import { AppLogo } from "@infiniroot/shared";

export function Draft() {
  return <AppLogo wordmark="draft" />;
}

export function Faab() {
  return <AppLogo wordmark="faab" />;
}

export function League() {
  return <AppLogo wordmark="league" />;
}

export function AllWordmarks() {
  return (
    <Stack gap="lg">
      <AppLogo wordmark="draft" />
      <AppLogo wordmark="faab" />
      <AppLogo wordmark="league" />
    </Stack>
  );
}
