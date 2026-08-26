import type { AuthErrorEnvelope } from "$lib/auth/auth-client";

export const CREDENTIAL_FAILURE = "Email or password is incorrect.";
export const RESET_CODE_SENT = "A reset code is on its way to your email.";
export const NO_ACCOUNT_EXISTS = "No account exists for that email.";
export const ALREADY_SIGNED_IN_RESET =
  "You're already signed in. Sign out first to reset your password.";
export const ACCOUNT_EXISTS_RESEND =
  "If that account exists and is unverified, a new verification code has been sent.";
export const VERIFY_EMAIL_NEXT =
  "Verify your email to continue. Check your inbox for the code we just sent.";
export const TWO_FA_NEXT =
  "Enter the 6-digit code from your authenticator app to finish signing in.";
export const RESET_SUCCESS = "Your password has been reset. You can sign in now.";
export const GENERIC_TRY_AGAIN = "Something went wrong. Please try again.";
export const NETWORK_ERROR = "Network error. Check your connection and try again.";
export const RATE_LIMIT = "Too many attempts. Please wait a moment and try again.";

export type ErrorKind =
  | "field"
  | "credential"
  | "verified-only"
  | "rate-limit"
  | "transport"
  | "server";

export interface ClassifiedError {
  readonly kind: ErrorKind;
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly message: string;
}

// Wire shape of an auth-error `context` payload. A field's value may be a plain
// message string, a list of `{ message }` entries (validator-style), or one such
// object. The payload may also nest the map under an `errors` key.
interface ErrorContextNode {
  readonly message?: unknown;
  readonly errors?: unknown;
}
type FieldErrorContextValue =
  | string
  | (string | ErrorContextNode)[]
  | ErrorContextNode;
type FieldErrorContext = Readonly<Record<string, FieldErrorContextValue>>;
type FieldErrors = Record<string, string>;

/* eslint-disable anti-slop/no-runtime-typeof -- pickFieldMessage is the JSON I/O-boundary parser for auth-error context values; typeof is the only way to discriminate string vs array vs object representations of parsed network data before any field is read */
function pickFieldMessage(value: FieldErrorContextValue | undefined): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && entry.trim()) return entry;
      if (entry && typeof entry === "object") {
        const msg = entry.message;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
  } else if (value && typeof value === "object") {
    const msg = value.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return null;
}
/* eslint-enable anti-slop/no-runtime-typeof */

export function extractFieldErrors(
  error: AuthErrorEnvelope | null,
  fields: ReadonlyArray<string>,
) {
  // SAFETY: an empty object literal satisfies Record<string, string> (zero key/value pairs), so this cast only names the accumulator's concrete type
  const out = {} as FieldErrors;
  if (!error?.context) return out;
  // SAFETY: error.context is the parsed JSON body of an auth-error response (truthy after the guard); treated as an opaque field map whose values are narrowed by pickFieldMessage before any string is read
  const root = error.context as FieldErrorContext;
  // SAFETY: the typeof guard proved the chosen branch is a non-null object; the auth API contract defines it as a field-keyed error map, and each value is re-validated by pickFieldMessage
  const bucket = (
    // eslint-disable-next-line anti-slop/no-runtime-typeof -- JSON boundary: typeof proves root.errors is an object map before we treat it as the field bucket
    root.errors && typeof root.errors === "object" ? root.errors : root
  ) as FieldErrorContext;
  for (const field of fields) {
    const msg = pickFieldMessage(bucket[field]);
    if (msg) out[field] = msg;
  }
  return out;
}

const CREDENTIAL_STATUSES = new Set([401, 403, 404]);
const CREDENTIAL_TYPES = new Set([
  "AUTH_001",
  "AUTH_002",
  "AUTH_003",
  "AUTH_004",
  "AUTH_006",
  "AUTH_009",
]);
const RATE_LIMIT_TYPES = new Set(["AUTH_007", "SRV_004"]);
export const VERIFIED_ONLY_TYPES = new Set(["AUTH_008"]);

export function isVerifiedOnlyError(error: AuthErrorEnvelope | null): boolean {
  if (!error?.type) return false;
  return VERIFIED_ONLY_TYPES.has(error.type);
}

export function isTransportFailure(status: number): boolean {
  return status === 0 || status >= 500;
}

export function isRateLimited(error: AuthErrorEnvelope | null, status: number): boolean {
  if (status === 429) return true;
  return (
    (error?.type != null && RATE_LIMIT_TYPES.has(error.type)) ||
    error?.retry_after !== undefined
  );
}

export function classifyAuthError(
  status: number,
  error: AuthErrorEnvelope | null,
  fields: ReadonlyArray<string>,
): ClassifiedError {
  if (status === 0) {
    return { kind: "transport", fieldErrors: {}, message: NETWORK_ERROR };
  }
  if (isRateLimited(error, status)) {
    const seconds = error?.retry_after;
    return {
      kind: "rate-limit",
      fieldErrors: {},
      message: seconds ? `Too many attempts. Please try again in ${seconds}s.` : RATE_LIMIT,
    };
  }
  if (status >= 500) {
    return { kind: "server", fieldErrors: {}, message: GENERIC_TRY_AGAIN };
  }
  const fieldErrors = extractFieldErrors(error, fields);
  const isValidationError = status === 400 && Object.keys(fieldErrors).length > 0;
  if (isValidationError) {
    const first = Object.values(fieldErrors)[0];
    return { kind: "field", fieldErrors, message: first ?? error?.message ?? GENERIC_TRY_AGAIN };
  }
  const type = error?.type;
  if (type && VERIFIED_ONLY_TYPES.has(type)) {
    return { kind: "verified-only", fieldErrors: {}, message: VERIFY_EMAIL_NEXT };
  }
  if (CREDENTIAL_STATUSES.has(status) || (type && CREDENTIAL_TYPES.has(type))) {
    return { kind: "credential", fieldErrors: {}, message: CREDENTIAL_FAILURE };
  }
  return {
    kind: "server",
    fieldErrors: {},
    message: error?.message ?? GENERIC_TRY_AGAIN,
  };
}
