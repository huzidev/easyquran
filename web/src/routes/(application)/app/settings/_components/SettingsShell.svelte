<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";

  let {
    copy,
    sections,
    active,
    onSelect,
    children,
  }: {
    copy: Pick<SettingsCopy, "title" | "sectionsLabel">;
    sections: { id: string; label: string }[];
    active: string;
    onSelect: (id: string) => void;
    children: Snippet;
  } = $props();

  function navItemClass(isActive: boolean): string {
    const base =
      "flex items-center whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors lg:w-full lg:rounded-lg lg:border-0 lg:bg-transparent lg:py-2.5 lg:text-start";
    if (isActive) {
      return cn(base, "border-accent bg-accent-soft font-medium text-fg lg:bg-accent-soft");
    }
    return cn(
      base,
      "border-line-2 bg-bg-1 text-fg-2 hover:border-line hover:text-fg lg:hover:bg-bg-2",
    );
  }
</script>

<div class="mx-auto max-w-[1180px] px-6 py-10 sm:px-7 sm:py-12">
  <h1 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">{copy.title}</h1>

  <div class="mt-8 flex flex-col gap-6 lg:mt-10 lg:flex-row lg:gap-0">
    <nav
      aria-label={copy.sectionsLabel}
      class="lg:sticky lg:top-[76px] lg:mb-10 lg:w-60 lg:shrink-0 lg:self-start lg:border-e lg:pe-8"
    >
      <ul
        class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
      >
        {#each sections as section (section.id)}
          <li class="shrink-0 lg:shrink">
            <a
              href={"#" + section.id}
              aria-current={section.id === active ? "page" : undefined}
              class={cn(
                navItemClass(section.id === active),
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              )}
              onclick={(event) => {
                event.preventDefault();
                onSelect(section.id);
              }}
            >
              {section.label}
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <div class="min-w-0 flex-1 lg:ps-10" aria-live="polite">
      {@render children()}
    </div>
  </div>
</div>
