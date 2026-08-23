import type { PermissionState } from "$lib/firebase/messaging";

export interface NotificationsState {
  readonly configured: boolean;
  readonly supported: boolean | null;
  readonly permission: PermissionState;
  readonly subscribed: boolean;
  readonly pushError: boolean;
}

export interface NotificationsCopy {
  readonly heading: string;
  readonly status: (state: NotificationsState) => string;
  readonly toggleBusy: string;
  readonly toggleDisable: string;
  readonly toggleBlocked: string;
  readonly toggleUnsupported: string;
  readonly toggleEnable: string;
}

export interface NotificationsStatusMessages {
  readonly unavailable: string;
  readonly checking: string;
  readonly browserUnsupported: string;
  readonly blocked: string;
  readonly error: string;
  readonly on: string;
  readonly offUpdates: string;
  readonly off: string;
}

export function notificationsStatus(
  messages: NotificationsStatusMessages,
): (state: NotificationsState) => string {
  return (state) => {
    if (!state.configured) return messages.unavailable;
    if (state.supported === null) return messages.checking;
    if (state.supported === false) return messages.browserUnsupported;
    if (state.permission === "denied") return messages.blocked;
    if (state.pushError && !state.subscribed) return messages.error;
    if (state.subscribed) return messages.on;
    if (state.permission === "default") return messages.offUpdates;
    return messages.off;
  };
}
