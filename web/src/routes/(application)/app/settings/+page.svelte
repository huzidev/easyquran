<script lang="ts">
  import { tick } from "svelte";
  import { page } from "$app/state";
  import { replaceState } from "$app/navigation";
  import { getSettingsCopy } from "$lib/i18n/settings-copy";
  import AppearanceSection from "./_components/AppearanceSection.svelte";
  import StorageSection from "./_components/StorageSection.svelte";
  import ReadingSection from "./_components/ReadingSection.svelte";
  import PrivacySection from "./_components/PrivacySection.svelte";
  import AccountSection from "./_components/AccountSection.svelte";
  import SettingsShell from "./_components/SettingsShell.svelte";

  const copy = getSettingsCopy();

  type SectionId = "storage" | "appearance" | "reading" | "privacy" | "account";

  const sections: { id: SectionId; label: string }[] = [
    { id: "storage", label: copy.nav.storage },
    { id: "appearance", label: copy.nav.appearance },
    { id: "reading", label: copy.nav.reading },
    { id: "privacy", label: copy.nav.privacy },
    { id: "account", label: copy.nav.account },
  ];

  function isSectionId(value: string): value is SectionId {
    return sections.some((section) => section.id === value);
  }

  function sectionFromHash(hash: string): SectionId {
    const id = hash.slice(1);
    if (isSectionId(id)) return id;
    return "storage";
  }

  let active = $state<SectionId>("storage");

  $effect(() => {
    active = sectionFromHash(location.hash);
    const syncFromHash = () => {
      active = sectionFromHash(location.hash);
    };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  });

  function select(id: string): void {
    if (!isSectionId(id) || active === id) return;
    active = id;
    replaceState(`#${id}`, page.state);
    void tick().then(() => {
      document.getElementById(id)?.focus();
    });
  }
</script>

<svelte:head>
  <title>{copy.title} · EasyQuran</title>
</svelte:head>

<div lang={copy.locale} dir={copy.direction}>
  <SettingsShell {copy} {sections} {active} onSelect={select}>
    {#if active === "storage"}
      <StorageSection id="storage" heading={copy.nav.storage} copy={copy.storage} />
    {:else if active === "appearance"}
      <AppearanceSection id="appearance" heading={copy.nav.appearance} copy={copy.appearance} />
    {:else if active === "reading"}
      <ReadingSection id="reading" heading={copy.nav.reading} copy={copy.reading} />
    {:else if active === "privacy"}
      <PrivacySection id="privacy" heading={copy.nav.privacy} copy={copy.privacy} />
    {:else}
      <AccountSection id="account" heading={copy.nav.account} copy={copy.account} />
    {/if}
  </SettingsShell>
</div>
