import { Alert } from "@mantine/core";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

interface LockedNoticeProps {
  children: ReactNode;
}

// Inline explanation for a field/section disabled because the draft has
// started (see convex/draft/auth.ts's requireDraftNotStarted) - sibling to
// UpgradePrompt, which is a full-page block for Pro gating and not a fit
// here since this needs to sit inline next to whatever it's explaining.
export function LockedNotice({ children }: LockedNoticeProps) {
  return (
    <Alert
      variant="light"
      color="gray"
      icon={<Lock size={16} />}
      title="Locked"
    >
      {children}
    </Alert>
  );
}
