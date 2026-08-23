<script lang="ts">
  import { isMessagingConfigured } from "$lib/firebase";
  import { notifications } from "$lib/stores/notifications.svelte";
  import type { NotificationsCopy } from "$lib/components/notifications/notifications-copy";
  import { cn } from "$lib/utils";

  const pill = "rounded-md border px-3 py-1.5 text-xs transition-colors duration-150";

  let {
    copy,
  }: {
    copy: NotificationsCopy;
  } = $props();

  async function toggle() {
    if (notifications.subscribed) await notifications.unsubscribe();
    else await notifications.subscribe();
  }

  function toggleLabel(): string {
    if (notifications.busy) return copy.toggleBusy;
    if (notifications.subscribed) return copy.toggleDisable;
    if (notifications.permission === "denied") return copy.toggleBlocked;
    if (notifications.supported === false) return copy.toggleUnsupported;
    return copy.toggleEnable;
  }

  const statusLabel = $derived(
    copy.status({
      configured: isMessagingConfigured,
      supported: notifications.supported,
      permission: notifications.permission,
      subscribed: notifications.subscribed,
      pushError: notifications.pushError,
    }),
  );

  let disabled = $derived(
    !notifications.subscribed && (!notifications.canSubscribe || !isMessagingConfigured),
  );
  let label = $derived(toggleLabel());
</script>

<div class="grid gap-1.5">
  <div class="flex items-center justify-between gap-2">
    <span class="text-xs text-fg-3">{copy.heading}</span>
    <span class="text-end text-[11px] leading-tight text-fg-3">
      {statusLabel}
    </span>
  </div>
  <button
    type="button"
    {disabled}
    onclick={toggle}
    aria-pressed={notifications.subscribed}
    class={cn(
      pill,
      notifications.subscribed
        ? "border-line-2 text-fg-2 hover:text-fg"
        : "border-accent bg-accent-soft text-fg hover:opacity-90",
      disabled && "cursor-not-allowed opacity-50",
    )}
  >
    {label}
  </button>
</div>
