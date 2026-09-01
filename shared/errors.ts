import { ConvexError } from "convex/values";

// Matches the "Uncaught Error: <message>" line inside Convex's server-error
// wrapper (the client-side error.message for a plain `throw new Error(...)`
// in a Convex function is the WHOLE wrapped block - request id, "Server
// Error", this line, then a stack trace - not just the message that was
// thrown). Not a documented/stable format, but consistent enough in
// practice to extract from; if it ever stops matching, callers just fall
// back to the generic message below instead of showing something wrong.
const UNCAUGHT_ERROR_PATTERN = /Uncaught (?:Error:\s*)?(.+?)(?:\n|$)/;

function looksWrapped(message: string): boolean {
  return (
    message.includes("Server Error") ||
    message.includes("Request ID") ||
    message.includes("\n")
  );
}

// Every `catch` around a useMutation/useAction call in this app should
// route through this instead of inlining `error instanceof Error ?
// error.message : fallback` - that pattern shows Convex's raw wrapped
// server-error text (stack trace and all) to the user whenever the backend
// throws a plain Error, which is nearly everywhere today (see convex/'s
// throw new Error(...) call sites - ConvexError isn't used server-side
// yet). This never returns raw wrapped text: a short, already-clean
// message (no wrapper markers) passes through as-is, a wrapped one gets
// its inner message extracted, and anything that doesn't clearly parse
// falls back to the caller-supplied generic message.
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    return typeof error.data === "string" ? error.data : fallback;
  }

  if (!(error instanceof Error)) {
    return fallback;
  }

  const { message } = error;
  if (!looksWrapped(message)) {
    return message;
  }

  const extracted = message.match(UNCAUGHT_ERROR_PATTERN)?.[1]?.trim();
  if (extracted && extracted.length > 0 && extracted.length < 300) {
    return extracted;
  }

  return fallback;
}
