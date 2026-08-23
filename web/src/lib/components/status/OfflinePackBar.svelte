<script lang="ts">
  import { offline } from "$lib/offline/offline-store.svelte";
  import type { OfflinePackCopy } from "$lib/components/status/offline-pack-copy";

  let { copy }: { copy: OfflinePackCopy } = $props();

  const working = $derived(offline.status === "downloading" || offline.status === "staging");
  const pct = $derived(working ? offline.pct : 0);
  const milestone = $derived.by(() => {
    if (!working) return "";
    if (pct >= 100) return copy.barReady;
    const bucket = Math.min(100, Math.floor(pct / 25) * 25);
    return bucket === 0 ? copy.barPreparing : `${bucket}%`;
  });
</script>

{#if working}
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-1.5 px-3 pt-3"
  >
    <div
      class="pointer-events-auto flex w-full max-w-sm items-center gap-2 rounded-full bg-bg-1 px-3.5 py-2 text-xs text-fg shadow-lg ring-1 ring-black/10"
    >
      <span class="inline-block size-1.5 shrink-0 animate-pulse rounded-full bg-accent"></span>
      <span class="truncate">{copy.barPreparing}</span>
      <span class="ms-auto tabular-nums opacity-70" aria-hidden="true">{pct}%</span>
    </div>
    <div class="h-1 w-full max-w-sm overflow-hidden rounded-full bg-bg-2 ring-1 ring-black/10">
      <div
        class="h-full rounded-full bg-accent transition-[width] duration-150 ease-out"
        style={`width:${pct}%`}
      ></div>
    </div>
    <span class="sr-only" aria-live="polite">{milestone}</span>
  </div>
{/if}
