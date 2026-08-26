import {
  check,
  forward,
  length,
  maxLength,
  minLength,
  nonEmpty,
  object,
  partialCheck,
  pipe,
  regex,
  string,
  trim,
  type InferOutput,
} from "valibot";
import { getAuthValidationCopy, type AuthValidationCopy } from "$lib/i18n/auth-validation-copy";

// Mirrors the server regex in rust/backend/api/src/modules/auth_v1/validator.rs::validate_email.
// Kept identical so the client never accepts an address the API will reject.
const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+$/;
const SIX_DIGITS_RE = /^[0-9]{6}$/;

// Server bounds: PASSWORD_MIN/PASSWORD_MAX in auth_v1 + forgot_password_v1 validators.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
// Server bound: CODE_LEN in email_verification_v1 (8-char alphanumeric).
export const EMAIL_CODE_LEN = 8;
// Server bounds: V1TwoFADisablePayload.code length(min = 6, max = 64) — 6-digit TOTP or a backup code.
const BACKUP_CODE_MIN = 6;
const BACKUP_CODE_MAX = 64;

// Text fields are trimmed before their checks so stray paste whitespace never
// produces an error; the submit handlers trim the value they send too.
function emailSchema(copy: AuthValidationCopy) {
  return pipe(string(), trim(), nonEmpty(copy.emailRequired), regex(EMAIL_RE, copy.emailInvalid));
}

function passwordSchema(copy: AuthValidationCopy) {
  return pipe(
    string(),
    nonEmpty(copy.passwordRequired),
    minLength(PASSWORD_MIN, copy.passwordMin),
    maxLength(PASSWORD_MAX, copy.passwordMax),
  );
}

function confirmPasswordSchema(copy: AuthValidationCopy) {
  return pipe(string(), nonEmpty(copy.confirmRequired));
}

function totpCodeSchema(copy: AuthValidationCopy) {
  return pipe(
    string(),
    trim(),
    nonEmpty(copy.codeRequired),
    regex(SIX_DIGITS_RE, copy.codeDigits),
  );
}

function emailCodeSchema(copy: AuthValidationCopy) {
  return pipe(
    string(),
    trim(),
    nonEmpty(copy.codeRequired),
    length(EMAIL_CODE_LEN, copy.codeLength8),
  );
}

// Server bound: CODE_LEN in forgot_password_v1 (6 numeric digits — an OTP-style
// reset code, distinct from the longer email-verification code).
function resetCodeSchema(copy: AuthValidationCopy) {
  return pipe(
    string(),
    trim(),
    nonEmpty(copy.codeRequired),
    regex(SIX_DIGITS_RE, copy.codeDigits),
  );
}

export function loginSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ email: emailSchema(copy), password: passwordSchema(copy) });
}

export function totpSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ code: totpCodeSchema(copy) });
}

export function registerSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return pipe(
    object({
      name: pipe(string(), trim(), nonEmpty(copy.nameRequired), maxLength(120, copy.nameMax)),
      email: emailSchema(copy),
      password: passwordSchema(copy),
      confirm_password: confirmPasswordSchema(copy),
    }),
    forward(
      partialCheck(
        [["password"], ["confirm_password"]],
        (input) => input.password === input.confirm_password,
        copy.confirmMismatch,
      ),
      ["confirm_password"],
    ),
  );
}

export function forgotRequestSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ email: emailSchema(copy) });
}

export function forgotVerifySchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ code: resetCodeSchema(copy) });
}

export function resetPasswordSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return pipe(
    object({
      password: passwordSchema(copy),
      confirm_password: confirmPasswordSchema(copy),
    }),
    forward(
      partialCheck(
        [["password"], ["confirm_password"]],
        (input) => input.password === input.confirm_password,
        copy.confirmMismatch,
      ),
      ["confirm_password"],
    ),
  );
}

export function verifyEmailSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ code: emailCodeSchema(copy) });
}

export function twoFactorVerifySchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({ code: totpCodeSchema(copy) });
}

export function twoFactorDisableSchema(copy: AuthValidationCopy = getAuthValidationCopy()) {
  return object({
    code: pipe(
      string(),
      trim(),
      nonEmpty(copy.codeRequired),
      check(
        (value) => value.length >= BACKUP_CODE_MIN && value.length <= BACKUP_CODE_MAX,
        copy.backupCodeInvalid,
      ),
    ),
  });
}

export type LoginValues = InferOutput<ReturnType<typeof loginSchema>>;
export type TotpValues = InferOutput<ReturnType<typeof totpSchema>>;
export type RegisterValues = InferOutput<ReturnType<typeof registerSchema>>;
export type ForgotRequestValues = InferOutput<ReturnType<typeof forgotRequestSchema>>;
export type ForgotVerifyValues = InferOutput<ReturnType<typeof forgotVerifySchema>>;
export type ResetPasswordValues = InferOutput<ReturnType<typeof resetPasswordSchema>>;
export type VerifyEmailValues = InferOutput<ReturnType<typeof verifyEmailSchema>>;
export type TwoFactorVerifyValues = InferOutput<ReturnType<typeof twoFactorVerifySchema>>;
export type TwoFactorDisableValues = InferOutput<ReturnType<typeof twoFactorDisableSchema>>;
