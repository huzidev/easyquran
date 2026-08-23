import type { MessagePayload, Messaging, Unsubscribe } from "firebase/messaging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { messaging, firebaseCore, analytics } = vi.hoisted(() => ({
  messaging: {
    getPermissionState: vi.fn<() => string>(),
    isMessagingSupported: vi.fn<() => Promise<boolean>>(),
    initMessaging: vi.fn<() => Promise<Messaging | null>>(),
    requestPermission: vi.fn<() => Promise<string>>(),
    getFcmToken: vi.fn<() => Promise<string | null>>(),
    registerTokenWithServer: vi.fn<() => Promise<boolean>>(),
    unregisterTokenFromServer: vi.fn<() => Promise<boolean>>(),
    deleteFcmToken: vi.fn<() => Promise<void>>(),
    onForegroundMessage: vi.fn<(cb: (p: MessagePayload) => void) => Promise<Unsubscribe>>(),
  },
  firebaseCore: { isConfigured: true, isMessagingConfigured: true },
  analytics: { track: vi.fn<() => void>() },
}));

vi.mock("$app/environment", () => ({ browser: true }));
vi.mock("$lib/firebase", () => firebaseCore);
vi.mock("$lib/firebase/messaging", () => messaging);
vi.mock("$lib/firebase/analytics", () => analytics);

import { createNotifications } from "$lib/stores/notifications.svelte";
import { notificationsStatus } from "$lib/components/notifications/notifications-copy";

const STORAGE_KEY = "easyquran.fcm";
let foregroundCb: ((p: MessagePayload) => void) | undefined;

const statusMessages = {
  unavailable: "unavailable",
  checking: "checking",
  browserUnsupported: "browser-unsupported",
  blocked: "blocked",
  error: "error",
  on: "on",
  offUpdates: "off-updates",
  off: "off",
};

function resetMocks(): void {
  messaging.getPermissionState.mockReset();
  messaging.isMessagingSupported.mockReset();
  messaging.initMessaging.mockReset();
  messaging.requestPermission.mockReset();
  messaging.getFcmToken.mockReset();
  messaging.registerTokenWithServer.mockReset();
  messaging.unregisterTokenFromServer.mockReset();
  messaging.deleteFcmToken.mockReset();
  messaging.onForegroundMessage.mockReset();
  analytics.track.mockReset();
  firebaseCore.isMessagingConfigured = true;
  messaging.getPermissionState.mockReturnValue("granted");
  messaging.isMessagingSupported.mockResolvedValue(true);
  messaging.initMessaging.mockResolvedValue(null);
  messaging.requestPermission.mockResolvedValue("granted");
  messaging.getFcmToken.mockResolvedValue("token-xyz");
  messaging.registerTokenWithServer.mockResolvedValue(true);
  messaging.unregisterTokenFromServer.mockResolvedValue(true);
  messaging.deleteFcmToken.mockResolvedValue(undefined);
  messaging.onForegroundMessage.mockImplementation((cb) => {
    foregroundCb = cb;
    return Promise.resolve(() => {});
  });
  foregroundCb = undefined;
}

async function flush(count = 10): Promise<void> {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationsStore.subscribe guards", () => {
  it("returns false and skips getFcmToken when subscribe is already busy", async () => {
    const store = createNotifications();
    let releasePermission: (value: string) => void = () => {};
    messaging.requestPermission.mockReturnValue(
      new Promise<string>((resolve) => {
        releasePermission = resolve;
      }),
    );
    const first = store.subscribe();
    await flush();
    const second = await store.subscribe();
    expect(second).toBe(false);
    expect(messaging.getFcmToken).not.toHaveBeenCalled();
    releasePermission("granted");
    await first;
  });

  it("returns false without registering when permission is denied", async () => {
    messaging.requestPermission.mockResolvedValue("denied");
    const store = createNotifications();
    const result = await store.subscribe();
    expect(result).toBe(false);
    expect(messaging.registerTokenWithServer).not.toHaveBeenCalled();
    expect(store.subscribed).toBe(false);
  });
});

describe("NotificationsStore hydration", () => {
  it("skips Messaging listeners and token refresh when unsupported", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "old", subscribed: true }));
    messaging.isMessagingSupported.mockResolvedValue(false);

    const store = createNotifications();
    store.hydrate();
    await flush();

    expect(store.supported).toBe(false);
    expect(store.subscribed).toBe(false);
    expect(messaging.onForegroundMessage).not.toHaveBeenCalled();
    expect(messaging.getFcmToken).not.toHaveBeenCalled();
    expect(messaging.initMessaging).not.toHaveBeenCalled();
    store.dispose();
  });

  it("wires once and refreshes an existing subscription when supported", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "old", subscribed: true }));

    const store = createNotifications();
    store.hydrate();
    store.hydrate();
    await flush();

    expect(store.supported).toBe(true);
    expect(messaging.onForegroundMessage).toHaveBeenCalledTimes(1);
    expect(messaging.getFcmToken).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});

describe("NotificationsStore.subscribe happy path", () => {
  it("registers the token, flips subscribed, and persists the record", async () => {
    messaging.getFcmToken.mockResolvedValue("abc-123");
    const store = createNotifications();
    const result = await store.subscribe();
    expect(result).toBe(true);
    expect(messaging.registerTokenWithServer).toHaveBeenCalledWith("abc-123");
    expect(store.subscribed).toBe(true);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored).toEqual({ token: "abc-123", subscribed: true });
  });
});

describe("NotificationsStore #refreshToken dedup", () => {
  it("shares a single getFcmToken call across concurrent refresh triggers", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "old", subscribed: true }));
    let release: (value: string | null) => void = () => {};
    messaging.getFcmToken.mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    const store = createNotifications();
    store.hydrate();
    await flush();
    expect(messaging.getFcmToken).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(messaging.getFcmToken).toHaveBeenCalledTimes(1);
    release("new-token");
    await flush();
    store.dispose();
  });
});

describe("NotificationsStore generation race-guard", () => {
  it("does not register the stale token after unsubscribe bumps the generation", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "old", subscribed: true }));
    let release: (value: string | null) => void = () => {};
    messaging.getFcmToken.mockReturnValue(
      new Promise<string | null>((resolve) => {
        release = resolve;
      }),
    );
    messaging.unregisterTokenFromServer.mockResolvedValue(true);
    messaging.deleteFcmToken.mockResolvedValue(undefined);

    const store = createNotifications();
    store.hydrate();
    await flush();

    expect(messaging.getFcmToken).toHaveBeenCalledTimes(1);
    const unsub = store.unsubscribe();
    await flush();
    release("new-token");
    await unsub;
    await flush();

    expect(messaging.registerTokenWithServer).not.toHaveBeenCalled();
    expect(store.subscribed).toBe(false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored).toEqual({ token: null, subscribed: false });
    store.dispose();
  });
});

describe("NotificationsStore foreground message", () => {
  it("exposes the foreground payload and bumps the sequence counter", async () => {
    const store = createNotifications();
    store.hydrate();
    await flush();
    expect(foregroundCb).toBeTypeOf("function");
    const before = store.messageSeq;
    // SAFETY: minimal fixture for the foreground-message path; only messageId (a required string field) is read.
    foregroundCb?.({ messageId: "msg-1" } as MessagePayload);
    expect(store.lastMessage).toMatchObject({ messageId: "msg-1" });
    expect(store.messageSeq).toBe(before + 1);
    store.dispose();
  });

  it("clearMessage nulls the last message", async () => {
    const store = createNotifications();
    store.hydrate();
    await flush();
    // SAFETY: minimal fixture for the foreground-message path; only messageId (a required string field) is read.
    foregroundCb?.({ messageId: "msg-2" } as MessagePayload);
    expect(store.lastMessage).not.toBeNull();
    store.clearMessage();
    expect(store.lastMessage).toBeNull();
    store.dispose();
  });
});

describe("NotificationsStore.syncPermission", () => {
  it("revokes subscription when permission has flipped to denied", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: "tok", subscribed: true }));
    const store = createNotifications();
    store.hydrate();
    await flush();
    expect(store.subscribed).toBe(true);

    messaging.getPermissionState.mockReturnValue("denied");
    store.syncPermission();

    expect(store.subscribed).toBe(false);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    expect(stored).toEqual({ token: null, subscribed: false });
    store.dispose();
  });
});

describe("NotificationsStore capability split", () => {
  it("marks the store configured and supported on the Chrome-capable path", async () => {
    const store = createNotifications();
    expect(store.supported).toBe(null);
    store.hydrate();
    await flush();
    expect(store.configured).toBe(true);
    expect(store.supported).toBe(true);
  });

  it("reports unavailable when messaging is not configured even though the probe passes", async () => {
    firebaseCore.isMessagingConfigured = false;
    const store = createNotifications();
    store.hydrate();
    await flush();
    expect(store.supported).toBe(true);
    expect(store.configured).toBe(false);
    const label = notificationsStatus(statusMessages)({
      configured: store.configured,
      supported: store.supported,
      permission: store.permission,
      subscribed: store.subscribed,
      pushError: store.pushError,
    });
    expect(label).toBe("unavailable");
  });

  it("re-runs the support probe on visible tab return while unsupported", async () => {
    messaging.isMessagingSupported.mockResolvedValueOnce(false).mockResolvedValue(true);
    const store = createNotifications();
    store.hydrate();
    await flush();
    expect(store.supported).toBe(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await flush();
    expect(store.supported).toBe(true);
  });

  it("flags pushError when the token fetch fails and clears it on a later success", async () => {
    messaging.getFcmToken.mockResolvedValue(null);
    const store = createNotifications();
    await expect(store.subscribe()).resolves.toBe(false);
    expect(store.pushError).toBe(true);
    expect(
      notificationsStatus(statusMessages)({
        configured: true,
        supported: true,
        permission: store.permission,
        subscribed: store.subscribed,
        pushError: store.pushError,
      }),
    ).toBe("error");

    messaging.getFcmToken.mockResolvedValue("tok-retry");
    await expect(store.subscribe()).resolves.toBe(true);
    expect(store.pushError).toBe(false);
  });
});
