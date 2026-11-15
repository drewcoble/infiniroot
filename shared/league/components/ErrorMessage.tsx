import { Link } from "@tanstack/react-router";
import { Anchor } from "@mantine/core";
import { isYahooReconnectError } from "@shared/errors";

// An error's text, plus a link to the Yahoo connect screen when the error
// means the Yahoo connection is missing or revoked.
export function ErrorMessage({ message }: { message: string }) {
  if (!isYahooReconnectError(message)) return <>{message}</>;
  return (
    <>
      {message}{" "}
      {/* Typed loosely: shared/ is also compiled by apps without this route
          (see MatchupScoreCard). */}
      <Link {...({ to: "/add-league" as string, search: { provider: "yahoo" } } as { to: "/" })}>
        <Anchor component="span" inherit>
          Reconnect Yahoo
        </Anchor>
      </Link>
    </>
  );
}
