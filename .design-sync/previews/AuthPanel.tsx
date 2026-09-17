import { AuthPanel } from "@infiniroot/shared";

// AuthPanel's mode/error/success states are internal useState, not props -
// reachable only by typing/submitting, so a static preview can only show
// the sign-in form. See .design-sync/NOTES.md.
export function SignIn() {
  return <AuthPanel />;
}
