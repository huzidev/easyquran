/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vite-plus/test";
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_BASE_URL: "https://eq.test/api" } }));
import type {
  AuthClient,
  AuthErrorEnvelope,
  AuthRequestResult,
  UserProfile,
} from "$lib/auth/auth-client";
import { createRegisterFlow } from "$lib/auth/flows.svelte";

const UNVERIFIED: UserProfile = {
  id: 9,
  name: "New",
  email: "new@eq.test",
  avatar_id: null,
  is_verified: false,
  role: "user",
  two_fa_enabled: false,
  oauth_provider: null,
};

const VERIFIED: UserProfile = { ...UNVERIFIED, id: 10, is_verified: true };

function mockClient(): AuthClient & {
  unsafeRequest: ReturnType<typeof vi.fn>;
  refreshCsrf: ReturnType<typeof vi.fn>;
} {
  // SAFETY: test double — RegisterFlow calls only unsafeRequest and refreshCsrf; AuthClient's private CSRF machinery is never invoked here.
  return {
    unsafeRequest: vi.fn(),
    refreshCsrf: vi.fn().mockResolvedValue(undefined),
    clearCsrf: vi.fn(),
    getUser: vi.fn(),
  } as never;
}

// Unannotated so callers keep the vi.fn() types (tests override probe); the
// object structurally satisfies FlowStateLike at the createRegisterFlow call.
function mockState() {
  // SAFETY: test double — every FlowStateLike member is a vi.fn() with a matching signature; flows only invoke them.
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
// eslint-disable-next-line anti-slop/no-unknown-parameters -- data is the mocked register-201 HTTP body, opaque exactly like the unsafeRequest<unknown> payload the flow reads at runtime.
function okStatus(status: number, data: unknown, rotated = false): AuthRequestResult<unknown> {
  return { ok: true, status, data, error: null, rotated };
}
function err(status: number, body: AuthErrorEnvelope = {}): AuthRequestResult<never> {
  return { ok: false, status, data: null, error: body, rotated: false };
}

describe("RegisterFlow register->login->verification", () => {
  it("register then login (rotated) -> unverified step; refreshCsrf NOT called since rotated handled by client", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED)) // register
      .mockResolvedValueOnce(ok(UNVERIFIED, true)); // login rotated
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(true);
    expect(flow.step).toBe("unverified");
    expect(state.setUser).toHaveBeenCalledWith(UNVERIFIED);
    expect(state.transition).toHaveBeenCalledWith({ kind: "login" });
    expect(client.refreshCsrf).not.toHaveBeenCalled();
    expect(client.unsafeRequest).toHaveBeenNthCalledWith(
      1,
      "/auth/v1/register",
      expect.objectContaining({ method: "POST" }),
    );
    expect(client.unsafeRequest).toHaveBeenNthCalledWith(
      2,
      "/auth/v1/log_in",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("register then login rotated=false -> explicit refreshCsrf wait then proceed", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED))
      .mockResolvedValueOnce(ok(VERIFIED, false));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(true);
    expect(flow.step).toBe("done");
    expect(client.refreshCsrf).toHaveBeenCalledTimes(1);
    expect(state.setUser).toHaveBeenCalledWith(VERIFIED);
  });

  it("register -> login returns totp_required -> step totp, no setUser", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED))
      .mockResolvedValueOnce(ok({ status: "totp_required", totp_token: "t-1" }));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(false);
    expect(flow.step).toBe("totp");
    expect(state.setUser).not.toHaveBeenCalled();
  });

  it("register failure (400 field) -> form step, field error, login NOT attempted", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(
      err(400, { type: "invalid_input", context: { email: "already taken" } }),
    );
    const flow = createRegisterFlow({ client, state });
    flow.email = "taken@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(false);
    expect(flow.step).toBe("form");
    expect(flow.fieldErrors.email).toBe("already taken");
    expect(client.unsafeRequest).toHaveBeenCalledTimes(1);
  });

  it("register credential failure (401) -> uniform credential copy, no field leak", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(err(401, { type: "unauthorized" }));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(false);
    expect(flow.step).toBe("form");
    expect(flow.genericError).toBe("Email or password is incorrect.");
    expect(flow.fieldErrors).toEqual({});
    expect(client.unsafeRequest).toHaveBeenCalledTimes(1);
  });

  it("register ok but login credential failure -> form step, uniform copy", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED))
      .mockResolvedValueOnce(err(401, { type: "unauthorized" }));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(false);
    expect(flow.step).toBe("form");
    expect(flow.genericError).toBe("Email or password is incorrect.");
    expect(flow.fieldErrors).toEqual({});
    expect(state.setUser).not.toHaveBeenCalled();
  });

  it("register 409 AUTH_ALREADY_AUTHENTICATED -> adopts the live session, done", async () => {
    const client = mockClient();
    const state = mockState();
    state.probe.mockResolvedValue({ kind: "authenticated", user: VERIFIED });
    client.unsafeRequest.mockResolvedValueOnce(
      err(409, { type: "AUTH_ALREADY_AUTHENTICATED", message: "Already authenticated" }),
    );
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(true);
    expect(flow.step).toBe("done");
    expect(state.setUser).toHaveBeenCalledWith(VERIFIED);
    expect(client.unsafeRequest).toHaveBeenCalledTimes(1);
  });

  it("register ok but login 409 AUTH_ALREADY_AUTHENTICATED -> adopts the live session", async () => {
    const client = mockClient();
    const state = mockState();
    state.probe.mockResolvedValue({ kind: "authenticated", user: VERIFIED });
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED))
      .mockResolvedValueOnce(err(409, { type: "AUTH_ALREADY_AUTHENTICATED" }));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    const res = await flow.submit();
    expect(res).toBe(true);
    expect(flow.step).toBe("done");
    expect(state.setUser).toHaveBeenCalledWith(VERIFIED);
  });

  it("does NOT call verification endpoints during registration", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(okStatus(201, UNVERIFIED))
      .mockResolvedValueOnce(ok(UNVERIFIED, true));
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "strong-password-1";
    await flow.submit();
    // SAFETY: unsafeRequest's first argument is the endpoint path string (AuthClient signature), so recorded calls map to path strings.
    const calls = client.unsafeRequest.mock.calls.map((c) => c[0] as string);
    expect(calls.some((p) => p.includes("email_verification"))).toBe(false);
    expect(calls).toEqual(["/auth/v1/register", "/auth/v1/log_in"]);
  });

  it("confirm_password mismatch -> aborts with field error, register NOT attempted", async () => {
    const client = mockClient();
    const state = mockState();
    const flow = createRegisterFlow({ client, state });
    flow.email = "new@eq.test";
    flow.password = "strong-password-1";
    flow.confirmPassword = "different-password";
    const res = await flow.submit();
    expect(res).toBe(false);
    expect(flow.fieldErrors.confirm_password).toBe("Password and confirm password do not match");
    expect(flow.step).toBe("form");
    expect(client.unsafeRequest).not.toHaveBeenCalled();
  });
});
