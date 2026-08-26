/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vite-plus/test";
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_API_BASE_URL: "https://eq.test/api" } }));
import type { AuthClient, AuthErrorEnvelope, AuthRequestResult } from "$lib/auth/auth-client";
import { createForgotPasswordFlow } from "$lib/auth/flows.svelte";
import type { FlowStateLike } from "$lib/auth/flows.svelte";

function mockClient(): AuthClient & { unsafeRequest: ReturnType<typeof vi.fn> } {
  // SAFETY: test double — ForgotPasswordFlow calls only unsafeRequest; AuthClient's private CSRF machinery is never invoked here.
  return {
    unsafeRequest: vi.fn(),
    refreshCsrf: vi.fn(),
    clearCsrf: vi.fn(),
    getUser: vi.fn(),
  } as never;
}

function mockState(): FlowStateLike {
  // SAFETY: test double — every FlowStateLike member is a vi.fn() with a matching signature; flows only invoke them.
  return {
    transition: vi.fn().mockResolvedValue(undefined),
    setUser: vi.fn(),
    setTwoFaPending: vi.fn(),
    reset: vi.fn(),
    probe: vi.fn().mockResolvedValue({ kind: "anonymous" }),
  } as FlowStateLike;
}

function ok<T>(data: T, rotated = false): AuthRequestResult<T> {
  return { ok: true, status: 200, data, error: null, rotated };
}
function err(status: number, body: AuthErrorEnvelope = {}): AuthRequestResult<never> {
  return { ok: false, status, data: null, error: body, rotated: false };
}

function storageProbe() {
  const readKeys: string[] = [];
  const proxy = (store: Storage | undefined, label: string) => {
    if (!store) return;
    const origSet = store.setItem.bind(store);
    store.setItem = (key: string, value: string) => {
      readKeys.push(`${label}.set:${key}=${value}`);
      return origSet(key, value);
    };
  };
  proxy(localStorage, "local");
  proxy(sessionStorage, "session");
  return { readKeys };
}

describe("ForgotPasswordFlow request (explicit account-existence contract)", () => {
  it("200 -> reset-code-sent copy (green), genericError clear, step verify", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok({ message: "A password reset code..." }));
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "real@eq.test";
    const res = await flow.request();
    expect(res).toBe(true);
    expect(flow.step).toBe("verify");
    expect(flow.successMessage).toMatch(/reset code/i);
    expect(flow.genericError).toBeNull();
  });

  it("unknown email (404) -> no-account error, stays on request step", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(err(404, { type: "DB_002" }));
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "no-such-account@eq.test";
    const res = await flow.request();
    expect(res).toBe(false);
    expect(flow.step).toBe("request");
    expect(flow.genericError).toBe("No account exists for that email.");
    expect(flow.successMessage).toBeNull();
  });

  it("429 rate-limit on request -> rate-limit message", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(err(429, { retry_after: 60 }));
    const flow = createForgotPasswordFlow({ client, state });
    const res = await flow.request();
    expect(res).toBe(false);
    expect(flow.step).toBe("request");
    expect(flow.genericError).toMatch(/60s/);
    expect(flow.successMessage).toBeNull();
  });
});

describe("ForgotPasswordFlow verify -> reset token in MEMORY only", () => {
  it("verify success stores reset_token in memory, advances to reset step", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest.mockResolvedValueOnce(ok({ message: "sent" }));
    client.unsafeRequest.mockResolvedValueOnce(ok({ reset_token: "RESET-TOKEN-SECRET" }));
    const probe = storageProbe();
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "x@eq.test";
    await flow.request();
    const res = await flow.verifyCode();
    expect(res).toBe(true);
    expect(flow.step).toBe("reset");
    expect(flow.resetTokenInMemory).toBe(true);
    expect(probe.readKeys).toEqual([]);
  });

  it("reset token never appears in URL/path or storage: reset() posts it in body only", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(ok({ message: "sent" }))
      .mockResolvedValueOnce(ok({ reset_token: "SECRET-TOK" }))
      .mockResolvedValueOnce(ok({ message: "reset done" }));
    const probe = storageProbe();
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "x@eq.test";
    flow.code = "123456";
    flow.password = "new-strong-password";
    flow.confirmPassword = "new-strong-password";
    await flow.request();
    await flow.verifyCode();
    const res = await flow.reset();
    expect(res).toBe(true);
    expect(probe.readKeys).toEqual([]);
    const resetCall = client.unsafeRequest.mock.calls.find(
      (c) => c[0] === "/forgot_password/v1/reset",
    );
    expect(resetCall).toBeDefined();
    // SAFETY: resetCall is defined (expect above fails otherwise); unsafeRequest's first argument is the path string.
    const path = resetCall![0] as string;
    expect(path).not.toContain("SECRET-TOK");
    // SAFETY: unsafeRequest's second argument is the request init; reset() sends { body: { reset_token, password, ... } }.
    const body = (resetCall![1] as { body: Record<string, string> }).body;
    expect(body.reset_token).toBe("SECRET-TOK");
    expect(flow.resetTokenInMemory).toBe(false);
  });

  it("reset without token -> expired guard, no network call", async () => {
    const client = mockClient();
    const state = mockState();
    const flow = createForgotPasswordFlow({ client, state });
    const res = await flow.reset();
    expect(res).toBe(false);
    expect(flow.step).toBe("request");
    expect(flow.genericError).toMatch(/expired/i);
    expect(client.unsafeRequest).not.toHaveBeenCalled();
  });

  it("reset password mismatch -> field error on confirm_password", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(ok({ message: "sent" }))
      .mockResolvedValueOnce(ok({ reset_token: "TOK-2" }))
      .mockResolvedValueOnce(
        err(400, {
          type: "invalid_input",
          context: { confirm_password: "Password and confirm password do not match" },
        }),
      );
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "x@eq.test";
    await flow.request();
    await flow.verifyCode();
    const res = await flow.reset();
    expect(res).toBe(false);
    expect(flow.fieldErrors.confirm_password).toContain("match");
  });

  it("clearSecrets wipes the in-memory reset token", async () => {
    const client = mockClient();
    const state = mockState();
    client.unsafeRequest
      .mockResolvedValueOnce(ok({ message: "sent" }))
      .mockResolvedValueOnce(ok({ reset_token: "TOK-3" }));
    const flow = createForgotPasswordFlow({ client, state });
    flow.email = "x@eq.test";
    await flow.request();
    await flow.verifyCode();
    expect(flow.resetTokenInMemory).toBe(true);
    flow.clearSecrets();
    expect(flow.resetTokenInMemory).toBe(false);
  });
});
