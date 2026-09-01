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
import { getErrorMessage } from "@shared/errors";

// Same "collapse every sign-in failure to one generic message" reasoning as
// infinidraft's AuthPanel: this account and infinidraft's are the same
// authAccounts row (shared Convex deployment - see INFINILEAGUE.md in the
// infinidraft repo), so this hits the exact same email-enumeration risk.
const GENERIC_SIGN_IN_FAILURE =
  "Login failed. Check your email/password and try again.";

const ACCOUNT_ALREADY_EXISTS_PATTERN = /^Account .+ already exists$/;
const GENERIC_SIGN_UP_FAILURE =
  "Something went wrong creating your account. Please try again.";

function toFriendlySignUpMessage(rawMessage: string): string {
  if (rawMessage === "Invalid password") {
    return "Password must be at least 8 characters.";
  }
  if (ACCOUNT_ALREADY_EXISTS_PATTERN.test(rawMessage)) {
    return "Couldn't create an account with those details. Double-check the email, or try signing in instead - if you already have an infinidraft account, use that same email and password here.";
  }
  return GENERIC_SIGN_UP_FAILURE;
}

export function AuthPanel() {
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

  const handleSubmit = async () => {
    setStatus(null);
    const normalizedEmail = email.trim().toLowerCase();

    try {
      await signIn("password", {
        flow: mode === "signIn" ? "signIn" : "signUp",
        email: normalizedEmail,
        password,
        name: name || normalizedEmail,
      });
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
        <Button variant="default" onClick={() => void signOut()}>
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
