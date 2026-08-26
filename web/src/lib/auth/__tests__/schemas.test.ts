import { describe, expect, it } from "vite-plus/test";
import { safeParse } from "valibot";
import { issuesToFieldErrors } from "$lib/auth/form-validation.svelte";
import {
  forgotVerifySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  totpSchema,
  twoFactorDisableSchema,
  verifyEmailSchema,
} from "$lib/auth/schemas";
import { getAuthValidationCopy } from "$lib/i18n/auth-validation-copy";

const copy = getAuthValidationCopy("en");

// eslint-disable-next-line anti-slop/no-unknown-parameters -- test helper takes any of the auth schemas; each is a distinct valibot schema type and the values are literal fixtures.
function errorsFor(schema: Parameters<typeof safeParse>[0], value: unknown) {
  const result = safeParse(schema, value);
  return result.success ? {} : issuesToFieldErrors(result.issues);
}

const VALID_PASSWORD = "correct-horse-battery";

describe("loginSchema", () => {
  it("accepts a well-formed email and a 12+ char password", () => {
    expect(errorsFor(loginSchema(copy), { email: "a@b.co", password: VALID_PASSWORD })).toEqual({});
  });

  it("flags an empty email and an empty password separately", () => {
    expect(errorsFor(loginSchema(copy), { email: "", password: "" })).toEqual({
      email: copy.emailRequired,
      password: copy.passwordRequired,
    });
  });

  it("rejects addresses the server regex would reject", () => {
    for (const email of ["user", "user@", "user@domain", "user @domain.com", "user@@d.com"]) {
      expect(errorsFor(loginSchema(copy), { email, password: VALID_PASSWORD })).toEqual({
        email: copy.emailInvalid,
      });
    }
  });

  it("mirrors the server password bounds (12..256)", () => {
    expect(errorsFor(loginSchema(copy), { email: "a@b.co", password: "a".repeat(11) })).toEqual({
      password: copy.passwordMin,
    });
    expect(errorsFor(loginSchema(copy), { email: "a@b.co", password: "a".repeat(12) })).toEqual({});
    expect(errorsFor(loginSchema(copy), { email: "a@b.co", password: "a".repeat(256) })).toEqual({});
    expect(errorsFor(loginSchema(copy), { email: "a@b.co", password: "a".repeat(257) })).toEqual({
      password: copy.passwordMax,
    });
  });
});

describe("registerSchema", () => {
  const base = {
    name: "Sara",
    email: "sara@eq.test",
    password: VALID_PASSWORD,
    confirm_password: VALID_PASSWORD,
  };

  it("accepts a complete, matching form", () => {
    expect(errorsFor(registerSchema(copy), base)).toEqual({});
  });

  it("requires a display name", () => {
    expect(errorsFor(registerSchema(copy), { ...base, name: "" })).toEqual({
      name: copy.nameRequired,
    });
  });

  it("reports a mismatch on confirm_password, not password", () => {
    expect(errorsFor(registerSchema(copy), { ...base, confirm_password: "something-else" })).toEqual(
      { confirm_password: copy.confirmMismatch },
    );
  });

  it("asks for the confirmation before comparing it", () => {
    expect(errorsFor(registerSchema(copy), { ...base, confirm_password: "" })).toEqual({
      confirm_password: copy.confirmRequired,
    });
  });

  it("reports every bad field at once", () => {
    expect(
      errorsFor(registerSchema(copy), { name: "", email: "nope", password: "", confirm_password: "" }),
    ).toEqual({
      name: copy.nameRequired,
      email: copy.emailInvalid,
      password: copy.passwordRequired,
      confirm_password: copy.confirmRequired,
    });
  });
});

describe("code schemas", () => {
  it("totp takes exactly 6 digits", () => {
    expect(errorsFor(totpSchema(copy), { code: "123456" })).toEqual({});
    expect(errorsFor(totpSchema(copy), { code: "12345" })).toEqual({ code: copy.codeDigits });
    expect(errorsFor(totpSchema(copy), { code: "12345a" })).toEqual({ code: copy.codeDigits });
    expect(errorsFor(totpSchema(copy), { code: "" })).toEqual({ code: copy.codeRequired });
  });

  it("email-verification codes are 8 characters (server CODE_LEN)", () => {
    const schema = verifyEmailSchema(copy);
    expect(errorsFor(schema, { code: "abcd1234" })).toEqual({});
    expect(errorsFor(schema, { code: "abcd123" })).toEqual({ code: copy.codeLength8 });
    expect(errorsFor(schema, { code: "" })).toEqual({ code: copy.codeRequired });
  });

  it("reset codes are exactly 6 digits (server CODE_LEN)", () => {
    const schema = forgotVerifySchema(copy);
    expect(errorsFor(schema, { code: "123456" })).toEqual({});
    expect(errorsFor(schema, { code: "12345" })).toEqual({ code: copy.codeDigits });
    expect(errorsFor(schema, { code: "12345a" })).toEqual({ code: copy.codeDigits });
    expect(errorsFor(schema, { code: "1234567" })).toEqual({ code: copy.codeDigits });
    expect(errorsFor(schema, { code: "" })).toEqual({ code: copy.codeRequired });
  });

  it("2FA disable accepts a 6-digit code or a backup code up to 64 chars", () => {
    expect(errorsFor(twoFactorDisableSchema(copy), { code: "123456" })).toEqual({});
    expect(errorsFor(twoFactorDisableSchema(copy), { code: "a".repeat(64) })).toEqual({});
    expect(errorsFor(twoFactorDisableSchema(copy), { code: "12345" })).toEqual({
      code: copy.backupCodeInvalid,
    });
    expect(errorsFor(twoFactorDisableSchema(copy), { code: "a".repeat(65) })).toEqual({
      code: copy.backupCodeInvalid,
    });
  });
});

describe("resetPasswordSchema", () => {
  it("enforces the password floor and the match", () => {
    expect(
      errorsFor(resetPasswordSchema(copy), {
        password: VALID_PASSWORD,
        confirm_password: VALID_PASSWORD,
      }),
    ).toEqual({});
    expect(
      errorsFor(resetPasswordSchema(copy), { password: "short", confirm_password: "short" }),
    ).toEqual({ password: copy.passwordMin });
    expect(
      errorsFor(resetPasswordSchema(copy), {
        password: VALID_PASSWORD,
        confirm_password: `${VALID_PASSWORD}!`,
      }),
    ).toEqual({ confirm_password: copy.confirmMismatch });
  });
});
