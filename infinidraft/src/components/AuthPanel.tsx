import { useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useNavigate } from "@tanstack/react-router";
import {
  Alert,
  Button,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
// useConvexAuth from convex/react, not @convex-dev/auth/react - see
// __root.tsx's comment on the same import for why (the latter's
// isAuthenticated doesn't wait for server confirmation).
import { useConvexAuth } from "convex/react";
import { getErrorMessage } from "@shared/errors";

// @convex-dev/auth's Password provider throws distinctly different errors
// for "no such account" vs "wrong password" on sign-in - see node_modules/
// @convex-dev/auth/src/server/implementation/index.js's retrieveAccount,
// which throws new Error(result) for result "InvalidAccountId" |
// "InvalidSecret" | "TooManyFailedAttempts" (Password.js's own "Invalid
// credentials" fallback for a null result is dead code - retrieveAccount
// never actually returns null, it always throws first). Showing any of
// these - or even just their presence/absence - lets an attacker tell "no
// account with this email" apart from "right email, wrong password" (or
// "this email has an account and it's rate limited") just from which
// failure comes back. Every sign-in failure, known error or not, collapses
// to this exact same message so nothing about whether an email has an
// account is ever observable from here.
const GENERIC_SIGN_IN_FAILURE =
  "Login failed. Check your email/password and try again.";

// Sign-up has the same email-enumeration shape ("Account <email> already
// exists" literally names the email as already registered) but also has a
// failure mode sign-in doesn't: the password being typed right now is
// genuinely too weak. That one's fine to call out specifically - it's
// about this attempt, not about any existing account - so sign-up gets its
// own mapping rather than reusing sign-in's single blanket message.
const ACCOUNT_ALREADY_EXISTS_PATTERN = /^Account .+ already exists$/;
const GENERIC_SIGN_UP_FAILURE =
  "Something went wrong creating your account. Please try again.";

function toFriendlySignUpMessage(rawMessage: string): string {
  if (rawMessage === "Invalid password") {
    return "Password must be at least 8 characters.";
  }
  if (ACCOUNT_ALREADY_EXISTS_PATTERN.test(rawMessage)) {
    return "Couldn't create an account with those details. Double-check the email, or try signing in instead.";
  }
  return GENERIC_SIGN_UP_FAILURE;
}

export function AuthPanel() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const title = useMemo(
    () => (mode === "signIn" ? "Sign in" : "Create account"),
    [mode],
  );

  const handleSubmit = async () => {
    setStatus(null);

    // Also normalized server-side (convex/auth.ts's Password profile
    // callback) - doing it here too keeps what's displayed/retried
    // consistent with what actually gets looked up.
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await signIn("password", {
        flow: mode === "signIn" ? "signIn" : "signUp",
        email: normalizedEmail,
        password,
        name: name || normalizedEmail,
      });
      setStatus({ kind: "success", message: `${title} succeeded.` });
      // Always land on the dashboard after signing in, rather than
      // whatever route happened to still be in the address bar (e.g. from
      // signing out of a league that belonged to a different account on
      // this browser) - otherwise a fresh sign-in can render a route whose
      // leagueId belongs to whoever was signed in before, which then fails
      // that owner check as "not authorized" for the new account.
      void navigate({ to: "/", replace: true });
    } catch (error) {
      const message =
        mode === "signIn"
          ? GENERIC_SIGN_IN_FAILURE
          : toFriendlySignUpMessage(
              getErrorMessage(error, GENERIC_SIGN_UP_FAILURE),
            );
      setStatus({ kind: "error", message });
    }
  };

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return (
      <Stack gap="sm">
        <Text c="dimmed">You are signed in.</Text>
        <Button
          variant="default"
          onClick={() => {
            // Awaited, not fire-and-forget - see AppHeader.tsx's sign-out
            // handler for why racing navigate() against signOut() can leave
            // the app stuck on an auth-error screen.
            void (async () => {
              await signOut();
              await navigate({ to: "/", replace: true });
            })();
          }}
        >
          Sign out
        </Button>
      </Stack>
    );
  }

  return (
    <Stack gap="sm" py="sm">
      <Text fw={600}>{title}</Text>
      {mode === "signUp" && (
        <TextInput
          label="Name"
          placeholder="Your name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      )}
      <TextInput
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
      />
      <PasswordInput
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChange={(event) => setPassword(event.currentTarget.value)}
      />
      <Group>
        <Button onClick={handleSubmit}>{title}</Button>
        <Button
          variant="default"
          onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}
        >
          {mode === "signIn" ? "Create account" : "Use existing account"}
        </Button>
      </Group>
      {status && (
        <Alert
          color={status.kind === "success" ? "green" : "red"}
          variant="light"
        >
          {status.message}
        </Alert>
      )}
    </Stack>
  );
}
