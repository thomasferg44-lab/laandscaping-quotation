import { describe, expect, it, vi } from "vitest";
import { checkBusinessAccess, friendlyAuthError } from "./auth.js";

describe("friendlyAuthError", () => {
  it.each([
    [{ code: "invalid_credentials", message: "Invalid login credentials", status: 400 }, "Email or password is incorrect."],
    [{ message: "Invalid login credentials", status: 400 }, "Email or password is incorrect."],
    [{ code: "signup_disabled", message: "Signups not allowed for this instance", status: 422 }, "New accounts can't be created here. Ask Test Garden Co to set up your login."],
    [{ message: "Signups not allowed for otp", status: 422 }, "New accounts can't be created here. Ask Test Garden Co to set up your login."],
    [{ code: "email_not_confirmed", message: "Email not confirmed" }, "This login hasn't been confirmed yet. Ask whoever set up the tool to confirm it."],
    [{ code: "user_banned", message: "User is banned" }, "This login has been disabled."],
    [{ code: "over_request_rate_limit", status: 429 }, "Too many attempts. Wait a minute and try again."],
    [{ message: "rate limited", status: 429 }, "Too many attempts. Wait a minute and try again."],
    [{ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }, "Couldn't reach the server. Check your connection and try again."],
    [new TypeError("Failed to fetch"), "Couldn't reach the server. Check your connection and try again."],
    [{ code: "unexpected_failure", message: "Database error querying schema" }, "Sign-in failed. Please try again."],
  ])("%j", (error, message) => {
    expect(friendlyAuthError(error, "Test Garden Co")).toBe(message);
  });

  it("returns null when there is no error", () => {
    expect(friendlyAuthError(null)).toBeNull();
  });

  it("never echoes raw server text", () => {
    expect(friendlyAuthError({ message: "relation public.secret does not exist" })).not.toMatch(/secret/);
  });
});

describe("checkBusinessAccess", () => {
  const client = (result) => ({ rpc: vi.fn(async () => result) });

  it("granted when is_business_user() is true", async () => {
    const c = client({ data: true, error: null });
    await expect(checkBusinessAccess(c)).resolves.toBe("granted");
    expect(c.rpc).toHaveBeenCalledWith("is_business_user");
  });

  it("denied when false", async () => {
    await expect(checkBusinessAccess(client({ data: false, error: null }))).resolves.toBe("denied");
  });

  it("error when the call fails (e.g. patch not applied yet)", async () => {
    await expect(checkBusinessAccess(client({ data: null, error: { code: "PGRST202" } }))).resolves.toBe("error");
  });

  it("error when the network throws", async () => {
    const c = { rpc: vi.fn(async () => { throw new TypeError("Failed to fetch"); }) };
    await expect(checkBusinessAccess(c)).resolves.toBe("error");
  });
});
