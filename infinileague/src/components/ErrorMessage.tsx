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
      <Link to="/add-league" search={{ provider: "yahoo" }}>
        <Anchor component="span" inherit>
          Reconnect Yahoo
        </Anchor>
      </Link>
    </>
  );
}
