<script lang="ts">
  import type { Snippet } from "svelte";
  import { cn } from "$lib/utils";
  import { Icon, type IconName } from "$lib/components/icon";
  import type { SettingsCopy } from "$lib/i18n/settings-copy";

  let {
    copy,
    sections,
    active,
    onSelect,
    children,
  }: {
    copy: Pick<SettingsCopy, "title" | "sectionsLabel">;
    sections: { id: string; label: string; icon: IconName }[];
    active: string;
    onSelect: (id: string) => void;
    children: Snippet;
  } = $props();

  function navItemClass(isActive: boolean): string {
    const base =
      "flex items-center gap-2.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-[13.5px] transition-colors";
    if (isActive) {
      return cn(base, "border-accent bg-accent-soft font-medium text-fg");
    }
    return cn(base, "border-line-2 bg-bg-1 text-fg-2 hover:border-line hover:text-fg");
  }
</script>

<div class="mx-auto max-w-[1180px] px-6 pt-5 pb-10 sm:px-7 sm:pt-6 sm:pb-12">
  <h1 class="text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg">{copy.title}</h1>

  <nav aria-label={copy.sectionsLabel} class="mt-5 sm:mt-6">
    <ul class="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {#each sections as section (section.id)}
        <li class="shrink-0">
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
            <Icon
              name={section.icon}
              size={15}
              class={cn(
                "shrink-0 transition-colors",
                section.id === active ? "text-accent" : "text-fg-4",
              )}
            />
            {section.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <div class="mt-5 sm:mt-6" aria-live="polite">
    {#key active}
      <div class="animate-fade-up">
        {@render children()}
      </div>
    {/key}
  </div>
</div>
