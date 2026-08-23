import { browser } from "$app/environment";
import { registerServiceWorker } from "$lib/boot/service-worker";
import type { Messaging, MessagePayload, Unsubscribe } from "firebase/messaging";

import { isConfigured, FCM_VAPID_KEY, API_BASE_URL, initApp } from "./index";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

let messaging: Messaging | null = null;
let messagingPromise: Promise<Messaging | null> | null = null;

const foregroundCallbacks = new Set<(payload: MessagePayload) => void>();

export function getPermissionState(): PermissionState {
  if (!browser || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function isMessagingSupported(): Promise<boolean> {
  if (!browser) return false;
  if (!isConfigured || !FCM_VAPID_KEY) return false;
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return false;
  }
  try {
    const { isSupported } = await import("firebase/messaging");
    return await isSupported();
  } catch {
    return false;
  }
}

export function initMessaging(): Promise<Messaging | null> {
  if (!browser || !isConfigured || !FCM_VAPID_KEY) return Promise.resolve(null);
  if (!messagingPromise) {
    messagingPromise = (async () => {
      try {
        const core = await initApp();
        if (!core) return null;
        const { getMessaging, onMessage } = await import("firebase/messaging");
        const m = getMessaging(core);
        onMessage(m, (payload) => {
          window.dispatchEvent(new CustomEvent("easyquran:fcm", { detail: payload }));
          for (const cb of foregroundCallbacks) {
            try {
              cb(payload);
            } catch (err) {
              console.warn("[firebase] onMessage listener threw:", err);
            }
          }
        });
        messaging = m;
      } catch (err) {
        console.warn("[firebase] messaging failed to initialize:", err);
      }
      return messaging;
    })();
  }
  return messagingPromise;
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!browser || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await registerServiceWorker();
    if (!reg) return null;
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn("[firebase] service worker registration failed:", err);
    return null;
  }
}

export async function requestPermission(): Promise<PermissionState> {
  if (!browser || !("Notification" in window)) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return getPermissionState();
  }
}

export async function getFcmToken(): Promise<string | null> {
  if (!isConfigured || !FCM_VAPID_KEY) {
    console.warn("[firebase] messaging: VAPID key missing (set FCM_VAPID_KEY in ./index).");
    return null;
  }
  if (getPermissionState() !== "granted") return null;
  const m = await initMessaging();
  if (!m) return null;
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  try {
    const { getToken } = await import("firebase/messaging");
    return await getToken(m, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
  } catch (err) {
    console.warn("[firebase] getToken failed:", err);
    return null;
  }
}

export async function deleteFcmToken(): Promise<void> {
  const m = messaging ?? (await initMessaging());
  if (!m) return;
  try {
    const { deleteToken } = await import("firebase/messaging");
    await deleteToken(m);
  } catch (err) {
    console.warn("[firebase] deleteToken failed:", err);
  }
}

export async function onForegroundMessage(
  cb: (payload: MessagePayload) => void,
): Promise<Unsubscribe> {
  foregroundCallbacks.add(cb);
  await initMessaging();
  return () => {
    foregroundCallbacks.delete(cb);
  };
}

async function postDeviceEndpoint(
  path: string,
  body: { token: string; platform?: string },
): Promise<boolean> {
  if (!API_BASE_URL) return false;
  try {
    const res = await fetch(`${API_BASE_URL}/device/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[firebase] device ${path} failed:`, err);
    return false;
  }
}

export function registerTokenWithServer(token: string): Promise<boolean> {
  return postDeviceEndpoint("register", { token, platform: "web" });
}

export function unregisterTokenFromServer(token: string): Promise<boolean> {
  return postDeviceEndpoint("delete", { token });
}
