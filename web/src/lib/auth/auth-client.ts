import { env } from "$env/dynamic/public";

const DEFAULT_BASE = "/api";
const AUTH_API_BASE = (env.PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "") || DEFAULT_BASE;
const CSRF_HEADER = "csrf-token";
const ROTATED_HEADER = "x-eq-session-rotated";
const DEFAULT_TIMEOUT_MS = 12_000;

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  avatar_id: number | null;
  is_verified: boolean;
  role: string;
  two_fa_enabled: boolean;
  oauth_provider: string | null;
}

export interface AuthErrorEnvelope {
  type?: string;
  status?: number;
  message?: string;
  context?: unknown;
  retry_after?: number;
  request_id?: string;
}

export type SessionProbeResult =
  | { readonly kind: "authenticated"; readonly user: UserProfile }
  | { readonly kind: "anonymous" }
  | { readonly kind: "unknown"; readonly status?: number };

export interface AuthRequestResult<T> {
  readonly ok: boolean;
  readonly status: number;
  readonly data: T | null;
  readonly error: AuthErrorEnvelope | null;
  readonly rotated: boolean;
}

export class AuthTransportError extends Error {
  readonly status?: number;
  constructor(message = "auth network error", status?: number) {
    super(message);
    this.name = "AuthTransportError";
    this.status = status;
  }
}

type UnsafeMethod = "POST" | "PUT" | "PATCH" | "DELETE";

interface RequestHeaders {
  [key: string]: string;
}

export interface UnsafeRequestInit {
  readonly method: UnsafeMethod;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly exempt?: boolean;
  readonly timeoutMs?: number;
}

export interface WireObject {
  [key: string]: JsonValue;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | WireObject;

export function isString(value: JsonValue | undefined): value is string {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- primitive wire discriminator inside the JSON.parse boundary; wire fields carry no static type to branch on
  return typeof value === "string";
}

export function isNumber(value: JsonValue | undefined): value is number {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- primitive wire discriminator inside the JSON.parse boundary; wire fields carry no static type to branch on
  return typeof value === "number";
}

function isBoolean(value: JsonValue | undefined): value is boolean {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- primitive wire discriminator inside the JSON.parse boundary; wire fields carry no static type to branch on
  return typeof value === "boolean";
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- guards the unparsed fetch JSON boundary; the value carries no type until this predicate narrows it
export function isWireObject(value: unknown): value is WireObject {
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- typeof-object is the only discriminator available for arbitrary JSON.parse output before the WireObject narrow
  return typeof value === "object" && value !== null;
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the unparsed JSON body from fetch; this function is the I/O boundary parser that validates it field-by-field
export function decodeUserProfile(raw: unknown): UserProfile | null {
  if (!isWireObject(raw)) return null;
  const o = raw;
  if (!isNumber(o.id)) return null;
  if (!isString(o.email)) return null;
  return {
    id: o.id,
    name: isString(o.name) ? o.name : "",
    email: o.email,
    avatar_id: isNumber(o.avatar_id) ? o.avatar_id : null,
    is_verified: isBoolean(o.is_verified) ? o.is_verified : false,
    role: isString(o.role) ? o.role : "user",
    two_fa_enabled: isBoolean(o.two_fa_enabled) ? o.two_fa_enabled : false,
    oauth_provider: isString(o.oauth_provider) ? o.oauth_provider : null,
  };
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- raw is the unparsed JSON error body from fetch; this function is the I/O boundary parser for it
export function decodeErrorEnvelope(raw: unknown): AuthErrorEnvelope | null {
  if (!isWireObject(raw)) return null;
  // Two wire shapes reach the client: ErrorResponse bodies (fields at the top
  // level, discriminator in `type`) and middleware-rendered AuthError bodies
  // (fields nested under `error`, discriminator in `code` — e.g. the 409
  // {"error":{"code":"AUTH_ALREADY_AUTHENTICATED",...}} guard rejection).
  const o = !isString(raw.type) && isWireObject(raw.error) ? raw.error : raw;
  const out: AuthErrorEnvelope = {};
  if (isString(o.type)) out.type = o.type;
  if (!out.type && isString(o.code)) out.type = o.code;
  if (isNumber(o.status)) out.status = o.status;
  if (isString(o.message)) out.message = o.message;
  if (o.context !== undefined && o.context !== null) out.context = o.context;
  if (isNumber(o.retry_after)) out.retry_after = o.retry_after;
  if (isString(o.request_id)) out.request_id = o.request_id;
  return out;
}

interface RequestOpts {
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

async function readBody<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    // SAFETY: JSON.parse returns any; T is the endpoint's response contract and every consumer validates the payload with a decode* boundary parser before use
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export class AuthClient {
  readonly apiBase: string = AUTH_API_BASE;
  #csrfToken: string | null = null;
  #bootstrapPromise: Promise<void> | null = null;
  #refreshing = false;

  getCsrfToken(): string | null {
    return this.#csrfToken;
  }

  clearCsrf(): void {
    this.#csrfToken = null;
    this.#bootstrapPromise = null;
  }

  #url(path: string): string {
    return `${this.apiBase}${path}`;
  }

  async #request<T>(
    method: string,
    path: string,
    opts: RequestOpts = {},
  ): Promise<AuthRequestResult<T>> {
    const headers: RequestHeaders = {
      accept: "application/json",
      ...opts.headers,
    };
    if (method !== "GET" && method !== "HEAD" && this.#csrfToken) {
      headers[CSRF_HEADER] = this.#csrfToken;
    }
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const external = opts.signal;
    const ctrl = new AbortController();
    const onAbort = (): void => ctrl.abort();
    if (external) {
      if (external.aborted) ctrl.abort();
      else external.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(this.#url(path), {
        method,
        headers,
        body,
        signal: ctrl.signal,
        credentials: "include",
      });
    } catch {
      throw new AuthTransportError();
    } finally {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onAbort);
    }

    const status = res.status;
    const rotated = res.headers.get(ROTATED_HEADER) === "1";
    const raw = await readBody<T>(res);
    const ok = res.ok;
    if (!ok) {
      return { ok: false, status, data: null, error: decodeErrorEnvelope(raw), rotated };
    }
    const data = raw;
    if (rotated && !this.#refreshing) {
      this.#refreshing = true;
      try {
        this.#csrfToken = await this.fetchCsrf();
      } catch {
        this.#csrfToken = null;
      } finally {
        this.#refreshing = false;
      }
    }
    return { ok: true, status, data, error: null, rotated };
  }

  async fetchCsrf(signal?: AbortSignal): Promise<string> {
    const res = await this.#request<WireObject>("POST", "/csrf/v1/generate", { signal });
    if (!res.ok) throw new AuthTransportError("csrf generate failed", res.status);
    const raw = res.data;
    const token = raw && isString(raw.token) ? raw.token : null;
    if (!token) throw new AuthTransportError("csrf generate returned no token", res.status);
    return token;
  }

  async ensureAnonymousSession(): Promise<void> {
    if (this.#csrfToken) return;
    if (this.#bootstrapPromise) return this.#bootstrapPromise;
    this.#bootstrapPromise = (async () => {
      try {
        this.#csrfToken = await this.fetchCsrf();
      } finally {
        this.#bootstrapPromise = null;
      }
    })();
    return this.#bootstrapPromise;
  }

  async refreshCsrf(): Promise<void> {
    this.#csrfToken = await this.fetchCsrf();
  }

  async unsafeRequest<T>(path: string, init: UnsafeRequestInit): Promise<AuthRequestResult<T>> {
    if (!init.exempt) await this.ensureAnonymousSession();
    return this.#request<T>(init.method, path, init);
  }

  async get<T>(
    path: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<AuthRequestResult<T>> {
    return this.#request<T>("GET", path, opts);
  }

  async getUser(signal?: AbortSignal): Promise<SessionProbeResult> {
    let res: AuthRequestResult<UserProfile>;
    try {
      res = await this.#request<UserProfile>("GET", "/user/v1/get", { signal });
    } catch {
      return { kind: "unknown" };
    }
    if (res.ok) {
      const user = decodeUserProfile(res.data);
      if (user) return { kind: "authenticated", user };
      return { kind: "unknown", status: res.status };
    }
    if (res.status === 401 || res.status === 403) return { kind: "anonymous" };
    return { kind: "unknown", status: res.status };
  }
}

export function createAuthClient(): AuthClient {
  return new AuthClient();
}

export const authClient: AuthClient = createAuthClient();
