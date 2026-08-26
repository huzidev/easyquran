/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vite-plus/test";
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_BASE_URL: "https://eq.test/api" } }));
import type { AuthClient, AuthErrorEnvelope, AuthRequestResult } from "$lib/auth/auth-client";
import type { UserProfile } from "$lib/auth/auth-client";
import { createLoginFlow } from "$lib/auth/flows.svelte";

const PROFILE: UserProfile = {
  id: 7,
  name: "Sara",
  email: "sara@eq.test",
  avatar_id: null,
  is_verified: true,
  role: "user",
  two_fa_enabled: false,
  oauth_provider: null,
};

const UNVERIFIED: UserProfile = { ...PROFILE, id: 8, is_verified: false, email: "new@eq.test" };

function mockClient() {
  // SAFETY: hand-built AuthClient test double — the class's #private csrf members are never
  // touched by LoginFlow, and every member these tests invoke is stubbed as a vi.fn().
  return {
    unsafeRequest: vi.fn(),
    refreshCsrf: vi.fn().mockResolvedValue(undefined),
    clearCsrf: vi.fn(),
    getUser: vi.fn(),
  } as AuthClient & {
    unsafeRequest: ReturnType<typeof vi.fn>;
    refreshCsrf: ReturnType<typeof vi.fn>;
    clearCsrf: ReturnType<typeof vi.fn>;
    getUser: ReturnType<typeof vi.fn>;
  };
}

function mockState() {
  return {
    transition: vi.fn().mockResolvedValue(undefined),
    setUser: vi.fn(),
    setTwoFaPending: vi.fn(),
    reset: vi.fn(),
    probe: vi.fn().mockResolvedValue({ kind: "anonymous" }),
  };
}

function ok<T>(data: T, rotated = false): AuthRequestResult<T> {
  return { ok: true, status: 200, data, error: null, rotated };
}
function err(
  status: number,
  body: AuthErrorEnvelope = {},
  rotated = false,
): AuthRequestResult<never> {
  return { ok: false, status, data: null, error: body, rotated };
}

describe("LoginFlow credentials", () => {
  it("success: transition(login) before setUser, then done", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok(PROFILE, true));
    const flow = createLoginFlow({ client, state });
    flow.email = "sara@eq.test";
    flow.password = "secret-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(true);
    expect(state.transition).toHaveBeenCalledWith({ kind: "login" });
    const transitionOrder = state.transition.mock.invocationCallOrder[0]!;
    const setUserOrder = state.setUser.mock.invocationCallOrder[0]!;
    expect(transitionOrder).toBeLessThan(setUserOrder);
    expect(state.setUser).toHaveBeenCalledWith(PROFILE);
    expect(state.setTwoFaPending).toHaveBeenCalledWith(false);
    expect(flow.step).toBe("done");
    expect(flow.pending).toBe(false);
  });

  it("401 -> uniform credential copy, no field leak, not authenticated", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(err(401, { type: "unauthorized" }));
    const flow = createLoginFlow({ client, state });
    flow.email = "x@y.z";
    flow.password = "whatever-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.genericError).toBe("Email or password is incorrect.");
    expect(flow.fieldErrors).toEqual({});
    expect(state.setUser).not.toHaveBeenCalled();
    expect(flow.step).toBe("credentials");
  });

  it("400 with field context -> per-field error, no generic banner", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(
      err(400, { type: "invalid_input", context: { email: "invalid email" } }),
    );
    const flow = createLoginFlow({ client, state });
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.fieldErrors.email).toBe("invalid email");
    expect(flow.genericError).toBeNull();
  });

  it("429 -> rate-limit message", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(err(429, { retry_after: 30 }));
    const flow = createLoginFlow({ client, state });
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.genericError).toContain("30s");
  });

  it("transport failure -> network message, no throw", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockRejectedValueOnce(new Error("net"));
    const flow = createLoginFlow({ client, state });
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.genericError).toMatch(/network/i);
  });

  it("409 AUTH_ALREADY_AUTHENTICATED -> adopts the live session and completes", async () => {
    const client = mockClient();
    const state = mockState();
    state.probe.mockResolvedValue({ kind: "authenticated", user: PROFILE });
    client.unsafeRequest.mockResolvedValueOnce(
      err(409, { type: "AUTH_ALREADY_AUTHENTICATED", message: "Already authenticated" }),
    );
    const flow = createLoginFlow({ client, state });
    flow.email = "x@y.z";
    flow.password = "whatever-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(true);
    expect(flow.step).toBe("done");
    expect(flow.genericError).toBeNull();
    expect(state.transition).toHaveBeenCalledWith({ kind: "login" });
    expect(state.setUser).toHaveBeenCalledWith(PROFILE);
  });

  it("409 with a dead session -> falls through to the classified copy", async () => {
    const client = mockClient();
    const state = mockState();
    state.probe.mockResolvedValue({ kind: "anonymous" });
    client.unsafeRequest.mockResolvedValueOnce(
      err(409, { type: "AUTH_ALREADY_AUTHENTICATED", message: "Already authenticated" }),
    );
    const flow = createLoginFlow({ client, state });
    flow.email = "x@y.z";
    flow.password = "whatever-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.step).toBe("credentials");
    expect(state.setUser).not.toHaveBeenCalled();
  });
});

describe("LoginFlow CSRF refresh on rotated=false fallback", () => {
  it("awaits refreshCsrf exactly once before transition/setUser when response did not rotate", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok(PROFILE, false));
    const flow = createLoginFlow({ client, state });
    flow.email = "sara@eq.test";
    flow.password = "secret-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(true);
    expect(client.refreshCsrf).toHaveBeenCalledTimes(1);
    const refreshOrder = client.refreshCsrf.mock.invocationCallOrder[0]!;
    const transitionOrder = state.transition.mock.invocationCallOrder[0]!;
    const setUserOrder = state.setUser.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeLessThan(transitionOrder);
    expect(refreshOrder).toBeLessThan(setUserOrder);
    expect(state.setUser).toHaveBeenCalledWith(PROFILE);
    expect(state.setTwoFaPending).toHaveBeenCalledWith(false);
    expect(flow.step).toBe("done");
  });

  it("skips refreshCsrf when the response already rotated the token", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok(PROFILE, true));
    const flow = createLoginFlow({ client, state });
    flow.email = "sara@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    expect(client.refreshCsrf).not.toHaveBeenCalled();
  });

  it("submitTotp: awaits refreshCsrf exactly once before transition/setUser when TOTP response did not rotate", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(ok({ status: "totp_required", totp_token: "tt-rot" }))
      .mockResolvedValueOnce(ok(PROFILE, false));
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    flow.code = "123456";
    const res = await flow.submitTotp();
    expect(res).toBe(true);
    expect(client.refreshCsrf).toHaveBeenCalledTimes(1);
    const refreshOrder = client.refreshCsrf.mock.invocationCallOrder[0]!;
    const transitionOrder = state.transition.mock.invocationCallOrder[0]!;
    const setUserOrder = state.setUser.mock.invocationCallOrder[0]!;
    expect(refreshOrder).toBeLessThan(transitionOrder);
    expect(refreshOrder).toBeLessThan(setUserOrder);
    expect(state.setUser).toHaveBeenCalledWith(PROFILE);
    expect(state.setTwoFaPending).toHaveBeenCalledWith(false);
    expect(flow.step).toBe("done");
  });

  it("submitTotp: skips refreshCsrf when the TOTP response already rotated the token", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(ok({ status: "totp_required", totp_token: "tt-rot2" }))
      .mockResolvedValueOnce(ok(PROFILE, true));
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    flow.code = "123456";
    await flow.submitTotp();
    expect(client.refreshCsrf).not.toHaveBeenCalled();
  });
});

describe("LoginFlow TOTP continuation", () => {
  it("totp_required stores token in memory, marks pending, does NOT authenticate", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(
      ok({ status: "totp_required", totp_token: "tt-123" }),
    );
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    const res = await flow.submitCredentials();
    expect(res).toBe(false);
    expect(flow.step).toBe("totp");
    expect(state.setTwoFaPending).toHaveBeenCalledWith(true);
    expect(state.setUser).not.toHaveBeenCalled();
  });

  it("submitTotp authenticates after success, clears token, marks done", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(
      ok({ status: "totp_required", totp_token: "tt-abc" }),
    );
    client.unsafeRequest.mockResolvedValueOnce(ok(PROFILE, true));
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    flow.code = "123456";
    const res = await flow.submitTotp();
    expect(res).toBe(true);
    expect(state.transition).toHaveBeenCalledWith({ kind: "login" });
    expect(state.setUser).toHaveBeenCalledWith(PROFILE);
    expect(state.setTwoFaPending).toHaveBeenCalledWith(false);
    expect(flow.step).toBe("done");
    expect(client.unsafeRequest).toHaveBeenNthCalledWith(
      2,
      "/auth/v1/login/totp",
      expect.objectContaining({ method: "POST", body: { totp_token: "tt-abc", code: "123456" } }),
    );
  });

  it("submitTotp without a pending token cancels and surfaces expired message", async () => {
    const client = mockClient();
    const state = mockState();
    const flow = createLoginFlow({ client, state });
    const res = await flow.submitTotp();
    expect(res).toBe(false);
    expect(flow.genericError).toMatch(/expired/i);
    expect(client.unsafeRequest).not.toHaveBeenCalled();
  });

  it("bad TOTP code -> code field error, still pending continuation", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(
      ok({ status: "totp_required", totp_token: "tt-xyz" }),
    );
    client.unsafeRequest.mockResolvedValueOnce(err(400, { type: "invalid_token" }));
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    flow.code = "000000";
    const res = await flow.submitTotp();
    expect(res).toBe(false);
    expect(flow.step).toBe("totp");
    expect(state.setUser).not.toHaveBeenCalled();
  });

  it("cancelTotp returns to credentials and clears two-factor pending", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok({ status: "totp_required", totp_token: "tt-z" }));
    const flow = createLoginFlow({ client, state });
    flow.email = "2fa@eq.test";
    flow.password = "secret-12345";
    await flow.submitCredentials();
    flow.cancelTotp();
    expect(flow.step).toBe("credentials");
    expect(state.setTwoFaPending).toHaveBeenCalledWith(false);
  });
});

describe("LoginFlow unverified redirect signal", () => {
  it("returns ok with an unverified profile so the route can redirect to /verify-email", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok(UNVERIFIED, true));
    const flow = createLoginFlow({ client, state });
    const res = await flow.submitCredentials();
    expect(res).toBe(true);
    expect(state.setUser).toHaveBeenCalledWith(UNVERIFIED);
    expect(flow.step).toBe("done");
  });
});
