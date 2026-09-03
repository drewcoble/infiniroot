import { processEnv } from "./env";

/**
 * Resend (https://resend.com) - used only by convex/auth/passwordReset.ts to
 * deliver the password-reset OTP email. Free tier: 100 emails/day, no
 * billing account required - see RESEND.md at the project root.
 *
 * Raw fetch() rather than the `resend` npm SDK, matching every other
 * integration in this codebase (FantasyPros/Sleeper/Yahoo/Gemini) - Stripe
 * is the one exception, and only because webhook HMAC verification
 * specifically needs its SDK.
 */
const API_BASE_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "infinidraft.com <onboarding@resend.dev>";

export function requireResendApiKey(): string {
  const apiKey = processEnv?.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. See RESEND.md at the project root for how " +
        "to get a free key, then run `npx convex env set RESEND_API_KEY <key>`.",
    );
  }
  return apiKey;
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = requireResendApiKey();
  const from = processEnv?.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM;

  const response = await fetch(API_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Resend API request failed: ${response.status} ${response.statusText}` +
        (body ? ` - ${body}` : ""),
    );
  }
}
