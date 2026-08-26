import type { AuthErrorEnvelope } from "$lib/auth/auth-client";
import {
  CREDENTIAL_FAILURE,
  classifyAuthError,
  extractFieldErrors,
  isRateLimited,
  isTransportFailure,
  NO_ACCOUNT_EXISTS,
  RESET_CODE_SENT,
  VERIFY_EMAIL_NEXT,
} from "$lib/auth/auth-copy";
import { describe, expect, it } from "vite-plus/test";

function env(over: Partial<AuthErrorEnvelope> = {}): AuthErrorEnvelope {
  return over;
}

describe("extractFieldErrors", () => {
  it("reads flat field messages from context", () => {
    const e = env({ context: { email: "invalid email", password: "too short" } });
    expect(extractFieldErrors(e, ["email", "password"])).toEqual({
      email: "invalid email",
      password: "too short",
    });
  });

  it("reads nested validator shape {errors: {field:[{message}]}}", () => {
    const e = env({
      context: { errors: { email: [{ message: "not an email", code: "email" }] } },
    });
    expect(extractFieldErrors(e, ["email"])).toEqual({ email: "not an email" });
  });

  it("ignores fields not present", () => {
    const e = env({ context: { email: "bad" } });
    expect(extractFieldErrors(e, ["email", "password"])).toEqual({ email: "bad" });
  });

  it("returns empty when context missing", () => {
    expect(extractFieldErrors(env(), ["email"])).toEqual({});
    expect(extractFieldErrors(null, ["email"])).toEqual({});
  });
});

describe("isTransportFailure / isRateLimited", () => {
  it("treats status 0 and >=500 as transport/server failure", () => {
    expect(isTransportFailure(0)).toBe(true);
    expect(isTransportFailure(500)).toBe(true);
    expect(isTransportFailure(503)).toBe(true);
    expect(isTransportFailure(401)).toBe(false);
  });

  it("rate limit by status, type, or retry_after", () => {
    expect(isRateLimited(null, 429)).toBe(true);
    expect(isRateLimited(env({ type: "AUTH_007" }), 400)).toBe(true);
    expect(isRateLimited(env({ type: "SRV_004" }), 400)).toBe(true);
    expect(isRateLimited(env({ retry_after: 30 }), 400)).toBe(true);
    expect(isRateLimited(env({ type: "VAL_001" }), 400)).toBe(false);
  });
});

describe("classifyAuthError", () => {
  it("status 0 -> transport", () => {
    const c = classifyAuthError(0, null, ["email"]);
    expect(c.kind).toBe("transport");
  });

  it("400 with field context -> field error", () => {
    const c = classifyAuthError(400, env({ context: { email: "invalid email" } }), ["email"]);
    expect(c.kind).toBe("field");
    expect(c.fieldErrors.email).toBe("invalid email");
    expect(c.message).toBe("invalid email");
  });

  it("401 -> uniform credential copy, no field leak", () => {
    const c = classifyAuthError(401, env({ type: "AUTH_001", message: "user id 7 not found" }), [
      "email",
      "password",
    ]);
    expect(c.kind).toBe("credential");
    expect(c.message).toBe(CREDENTIAL_FAILURE);
    expect(c.fieldErrors).toEqual({});
  });

  it("403 AUTH_004 -> credential", () => {
    const c = classifyAuthError(403, env({ type: "AUTH_004" }), ["password"]);
    expect(c.kind).toBe("credential");
  });

  it("AUTH_006 account-locked -> credential (no separate locked kind)", () => {
    const c = classifyAuthError(403, env({ type: "AUTH_006" }), []);
    expect(c.kind).toBe("credential");
  });

  it("verified-only AUTH_008/403 -> next-step copy, not credential loop", () => {
    const c = classifyAuthError(403, env({ type: "AUTH_008" }), []);
    expect(c.kind).toBe("verified-only");
    expect(c.message).toBe(VERIFY_EMAIL_NEXT);
  });

  it("AUTH_008 verified-only wins over 403 credential status fallback", () => {
    const credential = classifyAuthError(403, env({ type: "AUTH_004" }), []);
    expect(credential.kind).toBe("credential");
    const verified = classifyAuthError(403, env({ type: "AUTH_008" }), []);
    expect(verified.kind).toBe("verified-only");
  });

  it("rate-limit type AUTH_007 -> rate-limit even on non-429 status", () => {
    const c = classifyAuthError(400, env({ type: "AUTH_007" }), []);
    expect(c.kind).toBe("rate-limit");
  });

  it("429 -> rate-limit with retry_after seconds", () => {
    const c = classifyAuthError(429, env({ retry_after: 45 }), []);
    expect(c.kind).toBe("rate-limit");
    expect(c.message).toContain("45s");
  });

  it("500 -> server", () => {
    const c = classifyAuthError(500, env({ type: "SRV_001" }), []);
    expect(c.kind).toBe("server");
  });

  it("forgot-password copy: affirmative send + explicit no-account (flow concern, classifier pass-through)", () => {
    expect(RESET_CODE_SENT).toMatch(/reset code/i);
    expect(NO_ACCOUNT_EXISTS).toMatch(/no account exists/i);
  });
});
