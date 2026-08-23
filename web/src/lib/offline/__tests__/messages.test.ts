import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { STORAGE_STATS, STORAGE_STATS_ACK, requestStorageStats } from "$lib/offline/messages";

interface FakePort {
  // eslint-disable-next-line anti-slop/no-unknown-parameters -- FakePort mirrors the MessagePort surface the SUT exercises; postMessage payloads are the same untyped SW acks requestStorageStats validates, heterogeneous by design
  postMessage: (msg: unknown) => void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  start(): void;
}

function installFakeMessageChannel(): void {
  vi.stubGlobal("MessageChannel", function MessageChannel() {
    const port1: FakePort = {
      postMessage: () => {},
      close: () => {},
      onmessage: null,
      start: () => {},
    };
    const port2: FakePort = {
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- the fake port forwards raw ack payloads verbatim; the SUT's decoder is the parser under test, so the double stays opaque here
      postMessage: (msg: unknown) => {
        port1.onmessage?.({ data: msg });
      },
      close: () => {},
      onmessage: null,
      start: () => {},
    };
    return { port1, port2 };
  });
}

// eslint-disable-next-line anti-slop/no-unknown-parameters -- stubs navigator.serviceWorker.controller for varied fake-controller shapes (postMessage arity differs per test); the SUT reads it via the real ServiceWorker type, not this local annotation.
function stubController(controller: unknown): void {
  vi.stubGlobal("navigator", { serviceWorker: { controller } });
}

function flush(ms = 10): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestStorageStats client helper", () => {
  it("posts STORAGE_STATS on the controller with a transferred port and resolves the decoded ack", async () => {
    installFakeMessageChannel();
    let sent: { msg: { type: string }; port: FakePort | null } | null = null;
    const controller = {
      postMessage(msg: { type: string }, transfer: unknown[]): void {
        // SAFETY: requestStorageStats transfers port2 from installFakeMessageChannel, which is a FakePort instance in this test.
        sent = { msg, port: (transfer[0] as FakePort) ?? null };
      },
    };
    stubController(controller);

    const promise = requestStorageStats(5000);
    await flush(5);

    expect(sent).not.toBeNull();
    expect(sent!.msg.type).toBe(STORAGE_STATS);
    expect(sent!.port).not.toBeNull();

    sent!.port!.postMessage({
      type: STORAGE_STATS_ACK,
      pages: { entries: 2, bytes: 128 },
      data: { entries: 5, bytes: 512 },
    });

    await expect(promise).resolves.toEqual({
      pages: { entries: 2, bytes: 128 },
      data: { entries: 5, bytes: 512 },
    });
  });

  it("ignores acks with a wrong type or invalid layer stats, then resolves on a valid ack", async () => {
    installFakeMessageChannel();
    let sent: { msg: { type: string }; port: FakePort | null } | null = null;
    stubController({
      postMessage(msg: { type: string }, transfer: unknown[]): void {
        // SAFETY: requestStorageStats transfers port2 from installFakeMessageChannel, which is a FakePort instance in this test.
        sent = { msg, port: (transfer[0] as FakePort) ?? null };
      },
    });

    const promise = requestStorageStats(1000);
    await flush(5);

    const port = sent!.port!;
    port.postMessage({ type: "UNRELATED" });
    port.postMessage({
      type: STORAGE_STATS_ACK,
      pages: { entries: "two", bytes: 128 },
      data: { entries: 5, bytes: 512 },
    });
    port.postMessage({
      type: STORAGE_STATS_ACK,
      pages: { entries: 2, bytes: Number.NaN },
      data: { entries: 5, bytes: 512 },
    });
    port.postMessage({ type: STORAGE_STATS_ACK, pages: { entries: 2, bytes: 128 } });
    port.postMessage("not an object");
    port.postMessage({
      type: STORAGE_STATS_ACK,
      pages: { entries: 2, bytes: 128 },
      data: { entries: 5, bytes: 512 },
    });

    const stats = await promise;
    expect(stats).toEqual({ pages: { entries: 2, bytes: 128 }, data: { entries: 5, bytes: 512 } });
  });

  it("resolves null on its own when the worker never acks (timeout fallback)", async () => {
    installFakeMessageChannel();
    let posted = false;
    stubController({
      postMessage(): void {
        posted = true;
      },
    });

    await expect(requestStorageStats(20)).resolves.toBeNull();
    expect(posted).toBe(true);
  });

  it("resolves null without posting when no controller is attached", async () => {
    installFakeMessageChannel();
    let posted = false;
    stubController({
      postMessage(): void {
        posted = true;
      },
    });
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });

    await expect(requestStorageStats(20)).resolves.toBeNull();
    expect(posted).toBe(false);
  });

  it("resolves null when navigator.serviceWorker is undefined", async () => {
    vi.stubGlobal("navigator", {});
    await expect(requestStorageStats(20)).resolves.toBeNull();
  });
});
