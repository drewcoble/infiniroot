import { useMemo, useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  Alert,
  Button,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useConvexAuth } from "convex/react";
import { getErrorMessage } from "./errors";

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

interface AuthPanelProps {
  // Fired after a successful sign-in and after sign-out. infinidraft uses
  // this to always land on its dashboard afterward rather than whatever
  // route happened to still be in the address bar; infinifaab/infinileague
  // don't navigate at all, so they omit it.
  afterAuthChange?: () => void;
  // Appended to the "couldn't create an account" message when sign-up hits
  // an existing-account error - infinifaab/infinileague use this to point
  // the user at their shared-Convex-deployment sibling apps (each app names
  // the *other* apps, not itself); infinidraft omits it.
  existingAccountHint?: string;
}

export function AuthPanel({
  afterAuthChange,
  existingAccountHint,
}: AuthPanelProps = {}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signIn, signOut } = useAuthActions();
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

  function toFriendlySignUpMessage(rawMessage: string): string {
    if (rawMessage === "Invalid password") {
      return "Password must be at least 8 characters.";
    }
    if (ACCOUNT_ALREADY_EXISTS_PATTERN.test(rawMessage)) {
      const base =
        "Couldn't create an account with those details. Double-check the email, or try signing in instead";
      return existingAccountHint ? `${base} - ${existingAccountHint}` : `${base}.`;
    }
    return GENERIC_SIGN_UP_FAILURE;
  }

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
      afterAuthChange?.();
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
            // Awaited, not fire-and-forget - navigating before the auth
            // token actually clears left whatever authenticated route was
            // still mounted racing the sign-out, so it could get
            // invalidated mid-flight and throw "must be signed in" with no
            // way back to the sign-in form short of a hard reload.
            void (async () => {
              await signOut();
              afterAuthChange?.();
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
        <Button onClick={() => void handleSubmit()}>{title}</Button>
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
