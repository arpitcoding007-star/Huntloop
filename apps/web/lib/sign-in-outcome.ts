/**
 * What to tell somebody when Supabase refuses to send a sign-in link.
 *
 * On sign-in, an address without an account is refused (`otp_disabled`) and one
 * with an account can hit an email limit. Told apart from a success, either
 * lets anyone check whether a person is a customer, so both answer as a success
 * does. Sign-up creates the account it is asked for, so a limit there reveals
 * nothing and is reported.
 */
export type SignInOutcome = "sent" | "invalid" | "busy" | "unavailable";

const LIMITS = ["over_email_send_rate_limit", "over_request_rate_limit"];
const REFUSED_ADDRESS = ["email_address_invalid", "validation_failed"];

export function signInOutcome(
  error: { code?: string; status?: number } | null,
  mode: "login" | "signup",
): SignInOutcome {
  if (!error) return "sent";
  const code = error.code ?? "";

  // No such account. The screen it lands on offers to create one.
  if (mode === "login" && code === "otp_disabled") return "sent";
  if (LIMITS.includes(code) || error.status === 429) {
    // The request limit is per caller and is hit before any account is looked up.
    return mode === "login" && code !== "over_request_rate_limit" ? "sent" : "busy";
  }
  if (REFUSED_ADDRESS.includes(code)) return "invalid";
  return "unavailable";
}

/** None of these repeat Supabase's own text, which names the account's state. */
export const SIGN_IN_MESSAGES: Record<Exclude<SignInOutcome, "sent">, string> = {
  invalid: "That address can’t be used. Check it and try again.",
  busy: "Too many sign-in emails were asked for. Wait a few minutes and try again.",
  unavailable: "We couldn’t send the email. The address may be fine, so try again in a few minutes.",
};
