import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";

// Same generic-failure-message convention as shared/AuthPanel.tsx's
// sign-in path - every failure (wrong password, no such account, rate
// limited) collapses to this one message so nothing about whether a given
// email has an account is ever observable from the response. Sign-in
// only, deliberately - no sign-up flow here yet (an account is assumed to
// already exist from using the web app first); add a useSignUp alongside
// this if/when native-first account creation is actually needed.
const GENERIC_SIGN_IN_FAILURE =
  "Sign-in failed. Check your email/password and try again.";

export interface SignInState {
  submitting: boolean;
  error: string | null;
  submit: (email: string, password: string) => Promise<void>;
}

export function useSignIn(): SignInState {
  const { signIn } = useAuthActions();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (email: string, password: string) => {
    setSubmitting(true);
    setError(null);
    try {
      // Also normalized server-side (convex/auth.ts's Password profile
      // callback) - doing it here too keeps what's retried consistent with
      // what actually gets looked up.
      await signIn("password", {
        flow: "signIn",
        email: email.trim().toLowerCase(),
        password,
      });
    } catch {
      setError(GENERIC_SIGN_IN_FAILURE);
    } finally {
      setSubmitting(false);
    }
  };

  return { submitting, error, submit };
}
