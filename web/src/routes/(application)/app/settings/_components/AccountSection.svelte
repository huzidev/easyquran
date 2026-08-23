<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { authModal } from "$lib/auth/auth-modal.svelte";
  import { authState } from "$lib/auth/auth-state.svelte";
  import { publicHref } from "$lib/i18n/public-href";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";

  let {
    id,
    heading,
    copy,
  }: {
    id: string;
    heading: string;
    copy: SettingsCopy["account"];
  } = $props();

  const signedIn = $derived(authState.status === "authenticated");
  const user = $derived(authState.user);
  const accountHref = $derived(publicHref("/account"));
</script>

<div id={id} tabindex="-1" class="scroll-mt-24">
  <h2 class="text-[17px] font-semibold tracking-[-0.02em] text-fg">{heading}</h2>
  <p class="mt-1 max-w-[70ch] text-[14.5px] leading-relaxed text-fg-2">{copy.intro}</p>

  <div class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line-2 bg-bg-1">
    {#if signedIn}
      <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
        <div class="min-w-0">
          <span class="text-[14.5px] font-medium text-fg">{copy.signedInHeading}</span>
          {#if user?.name}
            <p class="mt-0.5 text-[13.5px] text-fg-3">{copy.signedInAs(user.name)}</p>
          {/if}
          {#if user?.email}
            <p class="text-[13.5px] text-fg-3">{user.email}</p>
          {/if}
        </div>
        <Button variant="ghost" size="sm" href={accountHref} class="shrink-0">
          {copy.open}
        </Button>
      </div>
    {:else}
      <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
        <p class="max-w-[50ch] min-w-0 text-[13.5px] leading-relaxed text-fg-3">
          {copy.signedOutNote}
        </p>
        <Button
          variant="accent"
          size="sm"
          class="shrink-0"
          onclick={() => authModal.show("login")}>{copy.signIn}</Button
        >
      </div>
    {/if}
  </div>

  <p class="mt-4 text-[13.5px] leading-snug text-fg-3">{copy.deviceNote}</p>
</div>
