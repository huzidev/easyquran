<script lang="ts">
  import { offline } from "$lib/offline/offline-store.svelte";
  import type { OfflinePackCopy } from "$lib/components/status/offline-pack-copy";
  import { cn, formatBytes } from "$lib/utils";

  const pill = "rounded-md border px-3 py-1.5 text-xs transition-colors duration-150";

  const working = $derived(offline.status === "downloading" || offline.status === "staging");
  const savedAt = $derived(offline.activePack?.savedAt ?? null);

  let {
    copy,
    headingTag = "span",
  }: {
    copy: OfflinePackCopy;
    headingTag?: "h3" | "span";
  } = $props();

  const statusLabel = $derived(
    copy.status({ status: offline.status, entries: offline.activePack?.entries ?? null }),
  );

  async function toggle() {
    if (offline.activePack) await offline.disable();
    else await offline.enable();
  }

  function packLabel(): string {
    if (offline.busy && !working) return copy.busy;
    if (offline.status === "error") return copy.retry;
    return offline.activePack ? copy.toggleOn : copy.toggleOff;
  }

  let label = $derived(packLabel());
</script>

<section class="grid gap-1.5">
  <div class="flex items-center justify-between gap-2">
    <svelte:element this={headingTag} class="text-xs text-fg-3">{copy.heading}</svelte:element>
    <span class="text-end text-[11px] leading-tight text-fg-3" aria-live="polite">{statusLabel}</span>
  </div>
  {#if offline.activePack}
    <div class="text-[11px] text-fg-4">
      {copy.routes(offline.activePack.entries, formatBytes(offline.activePack.bytes))}{#if savedAt}
        · {copy.saved(new Date(savedAt))}{/if}
    </div>
  {/if}
  {#if offline.quota != null}
    <div class="text-[11px] text-fg-4">
      {copy.usage(formatBytes(offline.usage))}
    </div>
  {/if}
  <button
    type="button"
    disabled={offline.busy}
    onclick={toggle}
    aria-pressed={!!offline.activePack}
    class={cn(
      pill,
      "justify-self-start px-3.5 py-2 text-[13.5px]",
      offline.activePack
        ? "border-line-2 text-fg-2 hover:text-fg"
        : "border-accent bg-accent-soft text-fg hover:opacity-90",
      offline.busy && "cursor-not-allowed opacity-50",
    )}
  >
    {label}
  </button>
</section>
