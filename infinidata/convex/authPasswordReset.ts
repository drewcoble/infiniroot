import { Email } from "@convex-dev/auth/providers/Email";
import { sendEmail } from "./email/resendClient";

// 8-digit numeric OTP via Web Crypto - available in Convex's default
// runtime (no "use node" needed, matching convex/auth.ts staying in the
// default runtime), so no extra dependency (the reference Convex Auth
// example uses oslo/crypto for this same job).
function generateOtp(): string {
  const digits = new Uint32Array(8);
  crypto.getRandomValues(digits);
  return Array.from(digits, (d) => d % 10).join("");
}

// Wired into convex/auth.ts as Password({ reset: PasswordResetEmail }) -
// @convex-dev/auth's Password provider already implements the "reset" and
// "reset-verification" flows (send a code / verify code + set new
// password) once a `reset` email provider is supplied; this is that
// provider. See RESEND.md for how to configure a Resend API key - this
// throws (via convex/email/resendClient.ts's requireResendApiKey) if one
// isn't set, so an unconfigured deployment fails loudly on first request
// rather than silently not sending anything.
export const PasswordResetEmail = Email({
  id: "password-reset",
  // 15 minutes - short enough to limit a leaked/intercepted code's window,
  // long enough that "check your email" isn't a race against expiry.
  maxAge: 60 * 15,
  async generateVerificationToken() {
    return generateOtp();
  },
  async sendVerificationRequest({ identifier: email, token, expires }) {
    await sendEmail({
      to: email,
      subject: "Reset your infinidraft.com password",
      html:
        `<p>Your password reset code is <strong>${token}</strong>.</p>` +
        `<p>This code expires at ${expires.toISOString()}.</p>` +
        `<p>If you didn't request this, you can safely ignore this email.</p>`,
    });
  },
});
