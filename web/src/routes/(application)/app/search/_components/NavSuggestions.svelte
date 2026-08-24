<script lang="ts">
  import type { QuranData } from "$lib/data/quran-data";
  import type { SearchCopy } from "$lib/i18n/search-copy";
  import type { NavMatch } from "$lib/search/nav/types";
  import { ayahHrefFor, juzHrefFor, pageHrefFor, surahHrefFor } from "$lib/search/page/navigate";

  let {
    copy,
    matches,
    quranData,
    sourceId,
  }: {
    copy: SearchCopy;
    matches: readonly NavMatch[];
    quranData: QuranData | null;
    sourceId: string | null;
  } = $props();

  function sajdaLabel(target: Extract<NavMatch["target"], { kind: "sajda" }>): string {
    const name = quranData?.surahByNum(target.surah)?.name;
    const ref = `${target.surah}:${target.ayah}`;
    if (name === undefined) return ref;
    return `${name} ${ref}`;
  }

  function sajdaKindLabel(target: Extract<NavMatch["target"], { kind: "sajda" }>): string {
    if (target.sajdaKind === "obligatory") return copy.navSajdaObligatory;
    return copy.navSajdaRecommended;
  }

  function hrefFor(match: NavMatch): string | null {
    if (sourceId === null) return null;
    if (match.target.kind === "juz") return juzHrefFor(sourceId, match.target.juz);
    if (match.target.kind === "page") return pageHrefFor(sourceId, match.target.page);
    if (quranData === null) return null;
    if (match.target.kind === "ayah") {
      return ayahHrefFor(sourceId, quranData, match.target.surah, match.target.ayah);
    }
    if (match.target.kind === "sajda") {
      return ayahHrefFor(sourceId, quranData, match.target.surah, match.target.ayah);
    }
    if (match.target.kind === "surah") return surahHrefFor(sourceId, quranData, match.target.surah);
    return null;
  }

  function labelFor(match: NavMatch): string {
    const target = match.target;
    if (target.kind === "juz") return copy.navJuz(target.juz);
    if (target.kind === "page") return copy.navPage(target.page);
    if (target.kind === "ayah") {
      return `${quranData?.surahByNum(target.surah)?.name ?? target.surah} ${target.surah}:${target.ayah}`;
    }
    if (target.kind === "sajda") return sajdaLabel(target);
    if (target.kind === "surah") {
      const entry = quranData?.surahByNum(target.surah);
      const name = entry?.name ?? String(target.surah);
      return entry ? `${target.surah}. ${name}` : name;
    }
    if (target.place === "medinan") {
      return `${copy.navPlaceMedinan} · ${copy.navPlaceCount(target.surahCount)}`;
    }
    return `${copy.navPlaceMeccan} · ${copy.navPlaceCount(target.surahCount)}`;
  }
</script>

{#if matches.length > 0}
  <section aria-label={copy.sectionNav} class="flex flex-col gap-1.5">
    <h2 class="text-[14.5px] font-medium text-fg">{copy.sectionNav}</h2>
    <ul class="flex flex-wrap gap-1.5">
      {#each matches as match (match.id)}
        {@const target = match.target}
        {@const href = target.kind === "place" ? null : hrefFor(match)}
        <li>
          {#if href !== null}
            <a
              href={href}
              class="flex items-baseline gap-1.5 rounded-full border border-line-2 bg-bg-1 px-3 py-1.5 text-[12.5px] text-fg-2 transition-colors hover:border-line hover:text-fg"
            >
              <span class="truncate">{labelFor(match)}</span>
              {#if target.kind === "sajda"}
                <span class="text-fg-3">{sajdaKindLabel(target)}</span>
              {/if}
            </a>
          {:else}
            <span
              class="flex items-baseline gap-1.5 rounded-full border border-line-2 bg-bg-1 px-3 py-1.5 text-[12.5px] text-fg-3"
            >
              <span class="truncate">{labelFor(match)}</span>
              {#if target.kind === "sajda"}
                <span>{sajdaKindLabel(target)}</span>
              {/if}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
