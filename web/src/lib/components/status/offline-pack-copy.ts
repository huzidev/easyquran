import type { OfflineStatus } from "$lib/offline/offline-store.svelte";

export interface OfflinePackStatusInput {
  readonly status: OfflineStatus;
  readonly entries: number | null;
}

export interface OfflinePackCopy {
  readonly heading: string;
  readonly status: (state: OfflinePackStatusInput) => string;
  readonly routes: (entries: number, size: string) => string;
  readonly saved: (when: Date) => string;
  readonly usage: (used: string) => string;
  readonly toggleOn: string;
  readonly toggleOff: string;
  readonly busy: string;
  readonly retry: string;
  readonly barPreparing: string;
  readonly barReady: string;
}

export interface OfflinePackStatusMessages {
  readonly active: (entries: number) => string;
  readonly on: string;
  readonly downloading: string;
  readonly staging: string;
  readonly error: string;
  readonly off: string;
}

export function offlinePackStatus(
  messages: OfflinePackStatusMessages,
): (state: OfflinePackStatusInput) => string {
  return (state) => {
    if (state.status === "active") {
      return state.entries === null ? messages.on : messages.active(state.entries);
    }
    if (state.status === "downloading") return messages.downloading;
    if (state.status === "staging") return messages.staging;
    if (state.status === "error") return messages.error;
    return messages.off;
  };
}
