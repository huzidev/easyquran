import { mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { StorageArtifactInfo } from "$lib/quran/protocol";
import type { DeleteOutcome } from "$lib/stores/storage-report.svelte";
import { getSettingsCopy } from "$lib/i18n/settings-copy";
import StorageArtifactRow from "../_components/StorageArtifactRow.svelte";

const storageCopy = getSettingsCopy("en").storage;

const artifact: StorageArtifactInfo = {
  id: "en.sahih",
  store: "opfs",
  tag: "sahih",
  sizeBytes: 4096,
  lastUsed: null,
};

let target: HTMLElement;
let unmountRow: () => void = () => {};

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function buttons(): HTMLButtonElement[] {
  return [...target.querySelectorAll("button")];
}

function buttonTexts(): string[] {
  return buttons().map((el) => el.textContent?.trim() ?? "");
}

function removeButton(): HTMLButtonElement {
  const el = buttons().find((btn) => btn.textContent?.trim() === storageCopy.remove);
  if (!el) throw new Error("missing remove button");
  return el;
}

function confirmButton(): HTMLButtonElement {
  const el = buttons().find((btn) => btn.textContent?.trim() === storageCopy.removeConfirmAction);
  if (!el) throw new Error("missing confirm button");
  return el;
}

async function click(el: HTMLButtonElement): Promise<void> {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await settle();
}

function mountRow(onremove: (id: string) => Promise<DeleteOutcome>): void {
  const instance = mount(StorageArtifactRow, {
    target,
    props: {
      artifact,
      name: "Sahih International",
      language: "English",
      copy: storageCopy,
      locale: "en",
      onremove,
    },
  });
  unmountRow = () => {
    void unmount(instance);
  };
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  unmountRow();
  target.remove();
});

describe("StorageArtifactRow delete confirm focus + re-entry guards", () => {
  it("focus moves to Confirm when the two-step starts and back to the row on Escape", async () => {
    mountRow(vi.fn().mockResolvedValue("ok"));
    await settle();

    await click(removeButton());
    expect(confirmButton()).toBe(document.activeElement);

    const panelKeydown = vi.fn();
    document.body.addEventListener("keydown", panelKeydown);
    confirmButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();

    expect(panelKeydown).not.toHaveBeenCalled();
    document.body.removeEventListener("keydown", panelKeydown);
    expect(buttonTexts()).toEqual([storageCopy.remove]);
    expect(removeButton()).toBe(document.activeElement);
  });

  it("a busy refusal renders its error copy and refocuses the remove button", async () => {
    mountRow(vi.fn().mockResolvedValue("busy"));
    await settle();

    await click(removeButton());
    await click(confirmButton());

    expect(buttonTexts()).toEqual([storageCopy.remove]);
    expect(target.textContent).toContain(storageCopy.busyError);
    expect(removeButton()).toBe(document.activeElement);
  });

  it("clicking Confirm again while the delete is pending calls onremove exactly once", async () => {
    let resolveDelete: (outcome: DeleteOutcome) => void = () => {};
    const onremove = vi.fn(
      (_id: string) =>
        new Promise<DeleteOutcome>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    mountRow(onremove);
    await settle();

    await click(removeButton());
    const confirm = confirmButton();
    confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    confirm.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();

    expect(onremove).toHaveBeenCalledTimes(1);
    expect(onremove).toHaveBeenCalledWith(artifact.id);

    resolveDelete("ok");
    await settle();
    expect(buttonTexts()).toEqual([storageCopy.remove]);
    expect(target.textContent).not.toContain(storageCopy.busyError);
  });
});
