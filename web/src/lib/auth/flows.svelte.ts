import { createAccountClient, type AccountClient } from "$lib/auth/account-client";
import {
  authClient,
  decodeUserProfile,
  type AuthClient,
  type AuthErrorEnvelope,
  type SessionProbeResult,
  type UnsafeRequestInit,
  type UserProfile,
} from "$lib/auth/auth-client";
import {
  ACCOUNT_EXISTS_RESEND,
  CREDENTIAL_FAILURE,
  classifyAuthError,
  GENERIC_TRY_AGAIN,
  isVerifiedOnlyError,
  NETWORK_ERROR,
  NO_ACCOUNT_EXISTS,
  RESET_CODE_SENT,
  RESET_SUCCESS,
  TWO_FA_NEXT,
  VERIFY_EMAIL_NEXT,
} from "$lib/auth/auth-copy";
import { authState } from "$lib/auth/auth-state.svelte";
import type { AuthTransitionContext } from "$lib/auth/auth-state.svelte";
import {
  createOAuthFlow,
  type OAuthFlow,
  type OAuthFlowDeps,
  type OAuthProvider,
} from "$lib/auth/oauth-flow.svelte";
import {
  createPasskeyFlow,
  type PasskeyFlow,
  type PasskeyFlowDeps,
} from "$lib/auth/passkey-flow.svelte";

export interface FlowStateLike {
  transition(ctx: AuthTransitionContext): Promise<void>;
  setUser(user: UserProfile | null): void;
  setTwoFaPending(pending: boolean): void;
  reset(): void;
  probe(): Promise<SessionProbeResult>;
}

export interface FlowDeps {
  readonly client?: AuthClient;
  readonly state?: FlowStateLike;
}

const LOGIN_FIELDS = ["email", "password"] as const;
const REGISTER_FIELDS = ["name", "email", "password", "confirm_password"] as const;
const VERIFY_EMAIL_FIELDS = ["code"] as const;
const FORGOT_REQUEST_FIELDS = ["email"] as const;
const FORGOT_VERIFY_FIELDS = ["email", "code"] as const;
const RESET_FIELDS = ["password", "confirm_password"] as const;
const TWO_FA_VERIFY_FIELDS = ["code"] as const;
const TWO_FA_DISABLE_FIELDS = ["code"] as const;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- data is an opaque HTTP response body (res.data from unsafeRequest<unknown>); decodeUserProfile parses/validates it inside.
function decodeUser(data: unknown): UserProfile | null {
  return decodeUserProfile(data);
}

interface TotpRequiredPayload {
  readonly status?: unknown;
  readonly totp_token?: unknown;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- data is an opaque HTTP response body (res.data from unsafeRequest<unknown>); this fn is the parser for the totp_required shape.
function isTotpRequired(data: unknown): { totpToken: string } | null {
  if (!data) return null;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an opaque HTTP body to "object" before reading fields; genuine runtime discrimination at the I/O boundary.
  if (typeof data !== "object") return null;
  // SAFETY: data is a non-null object (narrowed above); reading known totp-response fields, each validated before use.
  const o = data as TotpRequiredPayload;
  if (o.status !== "totp_required") return null;
  const totpToken = o.totp_token;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an opaque JSON field to string; the value is then truthiness-checked.
  if (typeof totpToken !== "string" || !totpToken) return null;
  return { totpToken };
}

interface CredentialFailure {
  readonly genericError: string | null;
  readonly fieldErrors: Readonly<Record<string, string>>;
}

// Shared by LoginFlow/RegisterFlow: same credential-error->form-state mapping in both.
function credentialFailure(
  status: number,
  error: AuthErrorEnvelope | null,
  fields: ReadonlyArray<string>,
): CredentialFailure {
  if (status === 0) {
    return { genericError: NETWORK_ERROR, fieldErrors: {} };
  }
  const c = classifyAuthError(status, error, fields);
  if (c.kind === "credential") {
    return { genericError: CREDENTIAL_FAILURE, fieldErrors: {} };
  } else if (c.kind === "field") {
    return { genericError: null, fieldErrors: c.fieldErrors };
  }
  return { genericError: c.message, fieldErrors: {} };
}

export class LoginFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  email = $state("");
  password = $state("");
  code = $state("");
  pending = $state(false);
  genericError = $state<string | null>(null);
  fieldErrors = $state<Readonly<Record<string, string>>>({});
  step = $state<"credentials" | "totp" | "done">("credentials");
  #totpToken: string | null = null;

  constructor(client: AuthClient, state: FlowStateLike) {
    this.client = client;
    this.state = state;
  }

  get twoFactorPending(): boolean {
    return this.step === "totp";
  }

  reset(): void {
    this.password = "";
    this.code = "";
    this.genericError = null;
    this.fieldErrors = {};
    this.step = "credentials";
    this.#totpToken = null;
    this.pending = false;
  }

  cancelTotp(): void {
    this.step = "credentials";
    this.#totpToken = null;
    this.code = "";
    this.genericError = null;
    this.fieldErrors = {};
    this.state.setTwoFaPending(false);
  }

  adoptTotpToken(token: string): void {
    this.#totpToken = token;
    this.step = "totp";
  }

  private fail(status: number, error: AuthErrorEnvelope | null): void {
    const f = credentialFailure(status, error, LOGIN_FIELDS);
    this.genericError = f.genericError;
    this.fieldErrors = f.fieldErrors;
  }

  async submitCredentials(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/log_in", {
        method: "POST",
        body: { email: this.email, password: this.password },
      });
      if (!res.ok) {
        this.fail(res.status, res.error);
        return false;
      }
      const totp = isTotpRequired(res.data);
      if (totp) {
        this.#totpToken = totp.totpToken;
        this.step = "totp";
        this.state.setTwoFaPending(true);
        this.genericError = TWO_FA_NEXT;
        return false;
      }
      if (!res.rotated) {
        try {
          await this.client.refreshCsrf();
        } catch {}
      }
      const user = decodeUser(res.data);
      if (!user) {
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      await this.state.transition({ kind: "login" });
      this.state.setUser(user);
      this.state.setTwoFaPending(false);
      this.step = "done";
      return true;
    } catch {
      this.fail(0, null);
      return false;
    } finally {
      this.pending = false;
    }
  }

  async submitTotp(): Promise<boolean> {
    if (this.pending) return false;
    if (!this.#totpToken) {
      this.cancelTotp();
      this.genericError = "Your sign-in session expired. Please start again.";
      return false;
    }
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/login/totp", {
        method: "POST",
        body: { totp_token: this.#totpToken, code: this.code },
      });
      if (!res.ok) {
        this.fail(res.status, res.error);
        if (this.fieldErrors.code) {
          this.genericError = null;
        } else if (
          res.status === 400 ||
          res.status === 401 ||
          res.status === 403 ||
          res.status === 422
        ) {
          this.fieldErrors = { code: "Invalid authentication code." };
          this.genericError = null;
        }
        return false;
      }
      if (!res.rotated) {
        try {
          await this.client.refreshCsrf();
        } catch {}
      }
      const user = decodeUser(res.data);
      if (!user) {
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      const token = this.#totpToken;
      this.#totpToken = null;
      void token;
      await this.state.transition({ kind: "login" });
      this.state.setUser(user);
      this.state.setTwoFaPending(false);
      this.step = "done";
      return true;
    } catch {
      this.fail(0, null);
      return false;
    } finally {
      this.pending = false;
    }
  }
}

export class RegisterFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  readonly login: LoginFlow;
  name = $state("");
  email = $state("");
  password = $state("");
  confirmPassword = $state("");
  pending = $state(false);
  genericError = $state<string | null>(null);
  fieldErrors = $state<Readonly<Record<string, string>>>({});
  step = $state<"form" | "registering" | "logging-in" | "unverified" | "totp" | "done">("form");

  constructor(client: AuthClient, state: FlowStateLike, login: LoginFlow) {
    this.client = client;
    this.state = state;
    this.login = login;
  }

  private fail(status: number, error: AuthErrorEnvelope | null): void {
    const f = credentialFailure(status, error, REGISTER_FIELDS);
    this.genericError = f.genericError;
    this.fieldErrors = f.fieldErrors;
  }

  async submit(): Promise<boolean> {
    if (this.pending) return false;
    if (this.password !== this.confirmPassword) {
      this.genericError = null;
      this.fieldErrors = { confirm_password: "Password and confirm password do not match" };
      return false;
    }
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    this.step = "registering";
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/register", {
        method: "POST",
        body: {
          name: this.name,
          email: this.email,
          password: this.password,
          confirm_password: this.confirmPassword,
        },
      });
      if (!res.ok) {
        this.step = "form";
        this.fail(res.status, res.error);
        return false;
      }
      this.login.email = this.email;
      this.login.password = this.password;
      this.step = "logging-in";
      const loggedIn = await this.runPostRegisterLogin();
      return loggedIn;
    } catch {
      this.step = "form";
      this.fail(0, null);
      return false;
    } finally {
      this.pending = false;
    }
  }

  private async runPostRegisterLogin(): Promise<boolean> {
    const res = await this.client.unsafeRequest<unknown>("/auth/v1/log_in", {
      method: "POST",
      body: { email: this.email, password: this.password },
    });
    if (!res.ok) {
      this.step = "form";
      this.fail(res.status, res.error);
      return false;
    }
    const totp = isTotpRequired(res.data);
    if (totp) {
      this.login.adoptTotpToken(totp.totpToken);
      this.step = "totp";
      this.state.setTwoFaPending(true);
      this.genericError = TWO_FA_NEXT;
      return false;
    }
    if (!res.rotated) {
      try {
        await this.client.refreshCsrf();
      } catch {}
    }
    const user = decodeUser(res.data);
    if (!user) {
      this.genericError = GENERIC_TRY_AGAIN;
      this.step = "form";
      return false;
    }
    await this.state.transition({ kind: "login" });
    this.state.setUser(user);
    this.step = user.is_verified ? "done" : "unverified";
    return true;
  }
}

export class VerifyEmailFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  code = $state("");
  pending = $state(false);
  resendPending = $state(false);
  genericError = $state<string | null>(null);
  successMessage = $state<string | null>(null);
  fieldErrors = $state<Readonly<Record<string, string>>>({});
  lastResentAt = $state<number | null>(null);
  verified = $state(false);
  alreadyVerified = $state(false);

  constructor(client: AuthClient, state: FlowStateLike) {
    this.client = client;
    this.state = state;
  }

  async resend(): Promise<boolean> {
    if (this.resendPending) return false;
    this.resendPending = true;
    this.genericError = null;
    this.successMessage = null;
    try {
      const res = await this.client.unsafeRequest<unknown>("/email_verification/v1/resend", {
        method: "POST",
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
        } else if (res.status === 401) {
          this.genericError = "Your session expired. Please log in again.";
        } else if (res.status === 403 || isVerifiedOnlyError(res.error)) {
          this.alreadyVerified = true;
          this.genericError = null;
        } else {
          const c = classifyAuthError(res.status, res.error, []);
          this.genericError = c.message;
        }
        return false;
      }
      this.lastResentAt = Date.now();
      this.successMessage = ACCOUNT_EXISTS_RESEND;
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.resendPending = false;
    }
  }

  async verify(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.successMessage = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/email_verification/v1/verify", {
        method: "POST",
        body: { code: this.code },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
        } else if (res.status === 401) {
          this.genericError = "Your session expired. Please log in again.";
          this.fieldErrors = {};
        } else if (res.status === 403 || isVerifiedOnlyError(res.error)) {
          this.alreadyVerified = true;
          this.genericError = null;
        } else {
          const c = classifyAuthError(res.status, res.error, VERIFY_EMAIL_FIELDS);
          if (c.kind === "field") {
            this.fieldErrors = c.fieldErrors;
          } else {
            this.genericError = c.message;
            this.fieldErrors = {};
          }
        }
        return false;
      }
      this.verified = true;
      this.genericError = null;
      await this.state.probe();
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }
}

interface ForgotPasswordVerifyPayload {
  readonly reset_token?: unknown;
}

export class ForgotPasswordFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  email = $state("");
  code = $state("");
  password = $state("");
  confirmPassword = $state("");
  pending = $state(false);
  genericError = $state<string | null>(null);
  successMessage = $state<string | null>(null);
  fieldErrors = $state<Readonly<Record<string, string>>>({});
  step = $state<"request" | "verify" | "reset" | "done">("request");
  #resetToken: string | null = null;

  constructor(client: AuthClient, state: FlowStateLike) {
    this.client = client;
    this.state = state;
  }

  get resetTokenInMemory(): boolean {
    return this.#resetToken !== null;
  }

  clearSecrets(): void {
    this.#resetToken = null;
  }

  async request(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.successMessage = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/forgot_password/v1/request", {
        method: "POST",
        body: { email: this.email },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
          return false;
        }
        // The API answers unknown emails with an explicit RecordNotFound (404) —
        // surface it instead of the generic classifier copy.
        if (res.status === 404) {
          this.genericError = NO_ACCOUNT_EXISTS;
          return false;
        }
        const c = classifyAuthError(res.status, res.error, FORGOT_REQUEST_FIELDS);
        if (c.kind === "field") {
          this.fieldErrors = c.fieldErrors;
        } else {
          this.genericError = c.message;
        }
        return false;
      }
      this.step = "verify";
      this.genericError = null;
      this.successMessage = RESET_CODE_SENT;
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }

  async verifyCode(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.successMessage = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/forgot_password/v1/verify", {
        method: "POST",
        body: { email: this.email, code: this.code },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
          return false;
        }
        const c = classifyAuthError(res.status, res.error, FORGOT_VERIFY_FIELDS);
        if (c.kind === "field") {
          this.fieldErrors = c.fieldErrors;
        } else {
          this.genericError = c.message;
        }
        return false;
      }
      // SAFETY: res.data is the verify endpoint JSON body; narrowing to read reset_token, which is validated as a string below before use.
      const data = res.data as ForgotPasswordVerifyPayload | null;
      // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an opaque JSON field to string at the I/O boundary.
      const token = data && typeof data.reset_token === "string" ? data.reset_token : null;
      if (!token) {
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      this.#resetToken = token;
      this.step = "reset";
      this.genericError = null;
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }

  async reset(): Promise<boolean> {
    if (this.pending) return false;
    if (!this.#resetToken) {
      this.step = "request";
      this.genericError = "Your reset session expired. Please start again.";
      return false;
    }
    this.pending = true;
    this.genericError = null;
    this.successMessage = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/forgot_password/v1/reset", {
        method: "POST",
        body: {
          reset_token: this.#resetToken,
          password: this.password,
          confirm_password: this.confirmPassword,
        },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
          return false;
        }
        const c = classifyAuthError(res.status, res.error, RESET_FIELDS);
        if (c.kind === "field") {
          this.fieldErrors = c.fieldErrors;
        } else {
          this.genericError = c.message;
        }
        return false;
      }
      this.#resetToken = null;
      this.step = "done";
      this.genericError = RESET_SUCCESS;
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }
}

export interface TwoFactorSetupData {
  readonly secret: string;
  readonly otpauthUrl: string;
  readonly backupCodes: ReadonlyArray<string>;
}

interface TwoFactorSetupPayload {
  readonly secret?: unknown;
  readonly otpauth_url?: unknown;
  readonly backup_codes?: unknown;
}

export class TwoFactorFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  verifyCode = $state("");
  disableCode = $state("");
  pending = $state(false);
  genericError = $state<string | null>(null);
  fieldErrors = $state<Readonly<Record<string, string>>>({});
  step = $state<"idle" | "setup" | "verify" | "enabled" | "disabled">("idle");
  #setup: TwoFactorSetupData | null = null;

  constructor(client: AuthClient, state: FlowStateLike) {
    this.client = client;
    this.state = state;
  }

  get setupData(): TwoFactorSetupData | null {
    return this.#setup;
  }

  clearSecrets(): void {
    this.#setup = null;
  }

  async setup(currentCode?: string): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    const code = currentCode?.trim();
    const init: UnsafeRequestInit = code
      ? { method: "POST", body: { code } }
      : { method: "POST" };
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/2fa/setup", init);
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
        } else if (res.status === 403 || isVerifiedOnlyError(res.error)) {
          this.genericError = VERIFY_EMAIL_NEXT;
        } else {
          const c = classifyAuthError(res.status, res.error, []);
          this.genericError = c.message;
        }
        return false;
      }
      // SAFETY: res.data is the 2fa/setup JSON body; narrowing to read secret/otpauth_url/backup_codes, each validated before use (secret/otpauth_url as strings, backup_codes via Array.isArray + string filter).
      const data = res.data as TwoFactorSetupPayload | null;
      // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an opaque JSON field to string at the I/O boundary.
      const secret = data && typeof data.secret === "string" ? data.secret : null;
      // eslint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an opaque JSON field to string at the I/O boundary.
      const otpauthUrl = data && typeof data.otpauth_url === "string" ? data.otpauth_url : null;
      // SAFETY: Array.isArray confirmed data.backup_codes is an array; element type cast to unknown because each element is validated as a string by the filter below.
      const backupCodes =
        data && Array.isArray(data.backup_codes) ? (data.backup_codes as unknown[]) : [];
      if (!secret || !otpauthUrl) {
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      this.#setup = {
        secret,
        otpauthUrl,
        // eslint-disable-next-line anti-slop/no-runtime-typeof -- type-guard predicate over opaque backup-code array elements; each element validated before inclusion.
        backupCodes: backupCodes.filter((c): c is string => typeof c === "string"),
      };
      this.step = "verify";
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }

  async verify(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/2fa/verify", {
        method: "POST",
        body: { code: this.verifyCode },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
        } else if (res.status === 403 || isVerifiedOnlyError(res.error)) {
          this.genericError = VERIFY_EMAIL_NEXT;
        } else {
          const c = classifyAuthError(res.status, res.error, TWO_FA_VERIFY_FIELDS);
          if (c.kind === "field") {
            this.fieldErrors = c.fieldErrors;
          } else if (res.status === 400 || res.status === 401 || res.status === 403) {
            this.fieldErrors = { code: "Invalid authentication code." };
          } else {
            this.genericError = c.message;
          }
        }
        return false;
      }
      const user = decodeUser(res.data);
      this.#setup = null;
      if (!user) {
        this.step = "idle";
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      await this.state.transition({ kind: "two-fa-verify" });
      this.state.setUser(user);
      this.step = "enabled";
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }

  async disable(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    this.fieldErrors = {};
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/2fa/disable", {
        method: "POST",
        body: { code: this.disableCode.trim() },
      });
      if (!res.ok) {
        if (res.status === 0) {
          this.genericError = NETWORK_ERROR;
        } else if (res.status === 403 || isVerifiedOnlyError(res.error)) {
          this.genericError = VERIFY_EMAIL_NEXT;
        } else {
          const c = classifyAuthError(res.status, res.error, TWO_FA_DISABLE_FIELDS);
          if (c.kind === "field") {
            this.fieldErrors = c.fieldErrors;
          } else if (res.status === 400 || res.status === 401 || res.status === 403) {
            this.fieldErrors = { code: "Invalid authentication code." };
            this.genericError = null;
          } else {
            this.genericError = c.message;
          }
        }
        return false;
      }
      const user = decodeUser(res.data);
      this.disableCode = "";
      if (!user) {
        this.genericError = GENERIC_TRY_AGAIN;
        return false;
      }
      await this.state.transition({ kind: "two-fa-disable" });
      this.state.setUser(user);
      this.step = "disabled";
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }
}

export class LogoutFlow {
  readonly client: AuthClient;
  readonly state: FlowStateLike;
  pending = $state(false);
  genericError = $state<string | null>(null);
  anonymous = $state(false);

  constructor(client: AuthClient, state: FlowStateLike) {
    this.client = client;
    this.state = state;
  }

  async run(): Promise<boolean> {
    if (this.pending) return false;
    this.pending = true;
    this.genericError = null;
    try {
      const res = await this.client.unsafeRequest<unknown>("/auth/v1/log_out", {
        method: "POST",
      });
      if (!res.ok && res.status !== 401 && res.status !== 403) {
        this.genericError = "Sign out failed. Please try again.";
        return false;
      }
      this.client.clearCsrf();
      await this.state.transition({ kind: "logout" });
      this.state.reset();
      const probe = await this.state.probe();
      this.anonymous = probe?.kind === "anonymous";
      return true;
    } catch {
      this.genericError = NETWORK_ERROR;
      return false;
    } finally {
      this.pending = false;
    }
  }
}

export interface AllFlows {
  login: LoginFlow;
  register: RegisterFlow;
  verifyEmail: VerifyEmailFlow;
  forgotPassword: ForgotPasswordFlow;
  twoFactor: TwoFactorFlow;
  logout: LogoutFlow;
  oauth: Readonly<Record<OAuthProvider, OAuthFlow>>;
  passkey: PasskeyFlow;
  account: AccountClient;
}

export interface FlowsDeps extends FlowDeps {
  readonly oauth?: OAuthFlowDeps;
  readonly passkey?: PasskeyFlowDeps;
}

export function createLoginFlow(deps: FlowDeps = {}): LoginFlow {
  return new LoginFlow(deps.client ?? authClient, deps.state ?? authState);
}

export function createRegisterFlow(deps: FlowDeps = {}): RegisterFlow {
  const client = deps.client ?? authClient;
  const state = deps.state ?? authState;
  const login = new LoginFlow(client, state);
  return new RegisterFlow(client, state, login);
}

export function createVerifyEmailFlow(deps: FlowDeps = {}): VerifyEmailFlow {
  return new VerifyEmailFlow(deps.client ?? authClient, deps.state ?? authState);
}

export function createForgotPasswordFlow(deps: FlowDeps = {}): ForgotPasswordFlow {
  return new ForgotPasswordFlow(deps.client ?? authClient, deps.state ?? authState);
}

export function createTwoFactorFlow(deps: FlowDeps = {}): TwoFactorFlow {
  return new TwoFactorFlow(deps.client ?? authClient, deps.state ?? authState);
}

export function createLogoutFlow(deps: FlowDeps = {}): LogoutFlow {
  return new LogoutFlow(deps.client ?? authClient, deps.state ?? authState);
}

const OAUTH_PROVIDERS: ReadonlyArray<OAuthProvider> = ["google", "apple", "facebook", "github"];

export function createOAuthFlows(deps: OAuthFlowDeps = {}) {
  // SAFETY: {} starts empty but the loop below assigns an OAuthFlow for every provider in OAUTH_PROVIDERS before return, so the record is complete at every key.
  const out = {} as Record<OAuthProvider, OAuthFlow>;
  for (const provider of OAUTH_PROVIDERS) {
    out[provider] = createOAuthFlow(provider, deps);
  }
  return out;
}

export function createFlows(deps: FlowsDeps = {}): AllFlows {
  const client = deps.client ?? authClient;
  const state = deps.state ?? authState;
  return {
    login: new LoginFlow(client, state),
    register: new RegisterFlow(client, state, new LoginFlow(client, state)),
    verifyEmail: new VerifyEmailFlow(client, state),
    forgotPassword: new ForgotPasswordFlow(client, state),
    twoFactor: new TwoFactorFlow(client, state),
    logout: new LogoutFlow(client, state),
    oauth: createOAuthFlows({
      client: deps.oauth?.client ?? client,
      state: deps.oauth?.state ?? state,
      navigate: deps.oauth?.navigate,
    }),
    passkey: createPasskeyFlow({
      client: deps.passkey?.client ?? client,
      state: deps.passkey?.state ?? state,
      credentials: deps.passkey?.credentials,
    }),
    account: createAccountClient(client),
  };
}
