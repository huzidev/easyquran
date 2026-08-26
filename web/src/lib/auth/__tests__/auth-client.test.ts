import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("$env/dynamic/public", () => ({
  env: { PUBLIC_API_BASE_URL: "https://eq.test/api" },
}));

import {
  AuthTransportError,
  createAuthClient,
  decodeErrorEnvelope,
  decodeUserProfile,
} from "$lib/auth/auth-client";

// eslint-disable-next-line anti-slop/no-unknown-parameters -- body is an arbitrary mocked JSON payload; jsonRes only serializes it via JSON.stringify, so there is no boundary contract to parse here.
function jsonRes(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

const PROFILE = {
  id: 7,
  name: "Sara",
  email: "sara@eq.test",
  avatar_id: null,
  is_verified: true,
  role: "user",
  two_fa_enabled: false,
  oauth_provider: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authClient.fetchCsrf", () => {
  it("POSTs /api/csrf/v1/generate with credentials and returns the token", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonRes({ message: "ok", token: "tok-1" }));
    const c = createAuthClient();
    const token = await c.fetchCsrf();
    expect(token).toBe("tok-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // SAFETY: the fetch spy records (url, init); fetchCsrf calls fetch with a string URL plus a RequestInit.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://eq.test/api/csrf/v1/generate");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
  });

  it("throws AuthTransportError when the body has no token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ message: "ok" }));
    const c = createAuthClient();
    await expect(c.fetchCsrf()).rejects.toBeInstanceOf(AuthTransportError);
  });

  it("throws AuthTransportError on a non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ type: "internal_server_error", status: 500 }, { status: 500 }),
    );
    const c = createAuthClient();
    await expect(c.fetchCsrf()).rejects.toBeInstanceOf(AuthTransportError);
  });
});

describe("authClient.getUser session probe semantics", () => {
  it("200 authenticates and decodes the profile", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes(PROFILE));
    const c = createAuthClient();
    const result = await c.getUser();
    expect(result).toEqual({ kind: "authenticated", user: decodeUserProfile(PROFILE) });
    // SAFETY: the expect above pinned result to { kind: "authenticated" } with the decoded PROFILE (id 7).
    expect((result as { user: { id: number } }).user.id).toBe(7);
  });

  it("401 resolves to anonymous (not throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ type: "unauthorized", status: 401 }, { status: 401 }),
    );
    const c = createAuthClient();
    await expect(Promise.resolve(c.getUser())).resolves.toEqual({ kind: "anonymous" });
  });

  it("403 resolves to anonymous (not throw)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ type: "forbidden", status: 403 }, { status: 403 }),
    );
    const c = createAuthClient();
    await expect(Promise.resolve(c.getUser())).resolves.toEqual({ kind: "anonymous" });
  });

  it("5xx resolves to retryable unknown with status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({ type: "internal_server_error", status: 500 }, { status: 500 }),
    );
    const c = createAuthClient();
    await expect(Promise.resolve(c.getUser())).resolves.toEqual({ kind: "unknown", status: 500 });
  });

  it("transport failure (fetch rejects) resolves to unknown without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network"));
    const c = createAuthClient();
    await expect(Promise.resolve(c.getUser())).resolves.toEqual({ kind: "unknown" });
  });
});

describe("authClient.ensureAnonymousSession single-flight bootstrap", () => {
  it("concurrent calls share a single fetchCsrf request", async () => {
    let resolveGenerate!: (v: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((res) => {
        resolveGenerate = res;
      }),
    );
    const c = createAuthClient();
    const p1 = c.ensureAnonymousSession();
    const p2 = c.ensureAnonymousSession();
    const p3 = c.ensureAnonymousSession();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveGenerate(jsonRes({ token: "anon-1" }));
    await Promise.all([p1, p2, p3]);
    expect(c.getCsrfToken()).toBe("anon-1");
  });

  it("is idempotent: a second call after success reuses the established session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ token: "anon-1" }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    await c.ensureAnonymousSession();
    await c.ensureAnonymousSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(c.getCsrfToken()).toBe("anon-1");
  });

  it("a failed bootstrap is retryable (token stays null, next call tries again)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonRes({ type: "internal_server_error", status: 500 }, { status: 500 }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonRes({ token: "anon-2" }));
    const c = createAuthClient();
    await expect(c.ensureAnonymousSession()).rejects.toBeInstanceOf(AuthTransportError);
    expect(c.getCsrfToken()).toBeNull();
    await c.ensureAnonymousSession();
    expect(c.getCsrfToken()).toBe("anon-2");
  });

  it("CSRF token is held in memory only and is never written to localStorage", async () => {
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ token: "anon-1" }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    expect(c.getCsrfToken()).toBe("anon-1");
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("authClient.unsafeRequest CSRF bootstrap ordering", () => {
  it("bootstraps the anonymous session before a non-exempt unsafe request", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = createAuthClient();
    const res = await c.unsafeRequest("/auth/v1/log_in", {
      method: "POST",
      body: { email: "a@b.c", password: "x" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // SAFETY: the fetch spy records (url, init); call 0 is the CSRF generate, call 1 the login POST.
    const firstUrl = (fetchMock.mock.calls[0] as [string, RequestInit])[0];
    // SAFETY: same (url, init) recording — call 1 is the login POST URL.
    const secondUrl = (fetchMock.mock.calls[1] as [string, RequestInit])[0];
    expect(firstUrl).toBe("https://eq.test/api/csrf/v1/generate");
    expect(secondUrl).toBe("https://eq.test/api/auth/v1/log_in");
    // SAFETY: same (url, init) recording — call 1's second element is the login RequestInit.
    const secondInit = (fetchMock.mock.calls[1] as [string, RequestInit])[1];
    expect(secondInit.headers).toMatchObject({ "csrf-token": "anon-1" });
    expect(secondInit.credentials).toBe("include");
    expect(res.ok).toBe(true);
  });

  it("exempt requests skip the bootstrap", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ ok: true }));
    const c = createAuthClient();
    await c.unsafeRequest("/auth/google/v1/login", { method: "POST", exempt: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // SAFETY: the fetch spy records (url, init); the exempt login POST is the only call.
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      "https://eq.test/api/auth/google/v1/login",
    );
  });

  it("reuses an established session across multiple unsafe requests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockImplementation(() => Promise.resolve(jsonRes({ ok: true })));
    const c = createAuthClient();
    await c.unsafeRequest("/auth/v1/log_in", { method: "POST", body: {} });
    await c.unsafeRequest("/auth/v1/log_out", { method: "POST" });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://eq.test/api/csrf/v1/generate",
      "https://eq.test/api/auth/v1/log_in",
      "https://eq.test/api/auth/v1/log_out",
    ]);
  });
});

describe("X-EQ-Session-Rotated header refreshes CSRF", () => {
  it("a rotated success response triggers a CSRF re-fetch before the result resolves", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "X-EQ-Session-Rotated": "1" },
        }),
      )
      .mockResolvedValueOnce(jsonRes({ token: "rotated-2" }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    expect(c.getCsrfToken()).toBe("anon-1");
    const res = await c.unsafeRequest("/auth/v1/log_in", { method: "POST", body: {} });
    expect(res.rotated).toBe(true);
    expect(c.getCsrfToken()).toBe("rotated-2");
    // SAFETY: the fetch spy records (url, init); call 2 is the post-rotation CSRF re-fetch.
    const rotatedRequestInit = (fetchMock.mock.calls[2] as [string, RequestInit])[1];
    expect(rotatedRequestInit.method).toBe("POST");
    // SAFETY: same (url, init) recording — call 2's URL is the CSRF generate endpoint.
    const rotatedUrl = (fetchMock.mock.calls[2] as [string, RequestInit])[0];
    expect(rotatedUrl).toBe("https://eq.test/api/csrf/v1/generate");
  });

  it("a non-rotated response leaves the token untouched", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(jsonRes({ ok: true }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    const res = await c.unsafeRequest("/user/v1/update", { method: "POST", body: {} });
    expect(res.rotated).toBe(false);
    expect(c.getCsrfToken()).toBe("anon-1");
  });

  it("rotation refresh is best-effort and does not fail the originating request", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "X-EQ-Session-Rotated": "1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({ type: "internal_server_error", status: 500 }, { status: 500 }),
      );
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    const res = await c.unsafeRequest("/auth/v1/log_in", { method: "POST", body: {} });
    expect(res.ok).toBe(true);
    expect(res.rotated).toBe(true);
    expect(c.getCsrfToken()).toBeNull();
  });

  it("a failed post-rotation refresh clears the stale token so the next unsafe request re-bootstraps CSRF", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "X-EQ-Session-Rotated": "1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonRes({ type: "internal_server_error", status: 500 }, { status: 500 }),
      )
      .mockResolvedValueOnce(jsonRes({ token: "anon-2" }))
      .mockResolvedValue(jsonRes({ ok: true }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    expect(c.getCsrfToken()).toBe("anon-1");
    const rotated = await c.unsafeRequest("/auth/v1/log_in", { method: "POST", body: {} });
    expect(rotated.rotated).toBe(true);
    expect(c.getCsrfToken()).toBeNull();
    const next = await c.unsafeRequest("/auth/v1/log_out", { method: "POST" });
    expect(next.ok).toBe(true);
    expect(c.getCsrfToken()).toBe("anon-2");
    const calls = fetchMock.mock.calls.map(([url]) => url);
    expect(calls).toEqual([
      "https://eq.test/api/csrf/v1/generate",
      "https://eq.test/api/auth/v1/log_in",
      "https://eq.test/api/csrf/v1/generate",
      "https://eq.test/api/csrf/v1/generate",
      "https://eq.test/api/auth/v1/log_out",
    ]);
    // SAFETY: the fetch spy records (url, init); call 3 is the post-failure re-bootstrap generate POST.
    const rebootstrapInit = (fetchMock.mock.calls[3] as [string, RequestInit])[1];
    expect(rebootstrapInit.method).toBe("POST");
  });
});

describe("authClient.refreshCsrf", () => {
  it("force-fetches a new token even when one is already established", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(jsonRes({ token: "refreshed-2" }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    expect(c.getCsrfToken()).toBe("anon-1");
    await c.refreshCsrf();
    expect(c.getCsrfToken()).toBe("refreshed-2");
    // SAFETY: the fetch spy records (url, init); call 1 is refreshCsrf's generate POST.
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "https://eq.test/api/csrf/v1/generate",
    );
  });
});

describe("authClient.clearCsrf", () => {
  it("drops the in-memory token so the next unsafe request re-bootstraps", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonRes({ token: "anon-1" }))
      .mockResolvedValueOnce(jsonRes({ token: "anon-2" }))
      .mockResolvedValue(jsonRes({ ok: true }));
    const c = createAuthClient();
    await c.ensureAnonymousSession();
    c.clearCsrf();
    expect(c.getCsrfToken()).toBeNull();
    await c.unsafeRequest("/auth/v1/log_out", { method: "POST" });
    // SAFETY: the fetch spy records (url, init); after clearCsrf, call 1 is the re-bootstrap generate POST.
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[0]).toBe(
      "https://eq.test/api/csrf/v1/generate",
    );
  });
});

describe("error envelope decoding", () => {
  it("decodes the backend error envelope fields", () => {
    const env = decodeErrorEnvelope({
      type: "rate_limited",
      status: 429,
      message: "slow down",
      retry_after: 30,
      request_id: "req-1",
      context: { key: "v" },
    });
    expect(env).toEqual({
      type: "rate_limited",
      status: 429,
      message: "slow down",
      retry_after: 30,
      request_id: "req-1",
      context: { key: "v" },
    });
  });

  it("decodes the middleware-wrapped AuthError envelope (code under `error`)", () => {
    const env = decodeErrorEnvelope({
      error: {
        code: "AUTH_ALREADY_AUTHENTICATED",
        context: null,
        message: "Already authenticated",
      },
    });
    expect(env).toEqual({
      type: "AUTH_ALREADY_AUTHENTICATED",
      message: "Already authenticated",
    });
  });

  it("top-level `type` wins over a nested `code` when both shapes appear", () => {
    const env = decodeErrorEnvelope({
      type: "AUTH_007",
      status: 429,
      message: "slow down",
      error: { code: "IGNORED", message: "nested" },
    });
    expect(env?.type).toBe("AUTH_007");
    expect(env?.message).toBe("slow down");
  });

  it("decodeUserProfile tolerates missing optional fields and rejects malformed input", () => {
    expect(decodeUserProfile(null)).toBeNull();
    expect(decodeUserProfile({ email: "x" })).toBeNull();
    const minimal = decodeUserProfile({ id: 1, email: "a@b.c" });
    expect(minimal).toEqual({
      id: 1,
      name: "",
      email: "a@b.c",
      avatar_id: null,
      is_verified: false,
      role: "user",
      two_fa_enabled: false,
      oauth_provider: null,
    });
  });
});
