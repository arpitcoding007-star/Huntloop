import { describe, expect, it } from "vitest";
import { signInOutcome } from "./sign-in-outcome";

describe("signInOutcome", () => {
  it("answers alike on sign-in whether or not the account exists", () => {
    const exists = signInOutcome(null, "login");
    expect(signInOutcome({ code: "otp_disabled", status: 422 }, "login")).toBe(exists);
    expect(signInOutcome({ code: "over_email_send_rate_limit", status: 429 }, "login")).toBe(exists);
  });

  it("reports limits where they reveal nothing", () => {
    expect(signInOutcome({ code: "over_email_send_rate_limit", status: 429 }, "signup")).toBe("busy");
    expect(signInOutcome({ code: "over_request_rate_limit", status: 429 }, "login")).toBe("busy");
  });

  it("does not claim a send when sign-up is closed or the sender is down", () => {
    expect(signInOutcome({ code: "otp_disabled", status: 422 }, "signup")).toBe("unavailable");
    expect(signInOutcome({ code: "unexpected_failure", status: 500 }, "login")).toBe("unavailable");
    expect(signInOutcome({}, "login")).toBe("unavailable");
  });

  it("blames the address only when the address is at fault", () => {
    expect(signInOutcome({ code: "email_address_invalid", status: 400 }, "login")).toBe("invalid");
  });
});
