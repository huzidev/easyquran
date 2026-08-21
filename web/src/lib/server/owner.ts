import { env } from "$env/dynamic/private";
import { SITE } from "$lib/config/site";
import { fetchWithTimeout } from "$lib/quran/fetch";
import type { OwnerPublic } from "$lib/types/owner";

const DEFAULT_SOURCE_URL = "https://hmziq.rs/me.json";
const OWNER_SOURCE_URL = env.OWNER_SOURCE_URL || DEFAULT_SOURCE_URL;
const FETCH_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 60 * 60 * 1000;

export interface OwnerProfile {
  username: string;
  name: string;
  title: string;
  tagline: string;
  yearsOfExperience: number;
  email: string;
  websites: { alternative: string; portfolio: string; cv: string };
  social: { github: string; linkedin: string; twitter: string; instagram: string };
}

const FALLBACK_PROFILE: OwnerProfile = {
  username: "hmziqrs",
  name: "hmziqrs",
  title: "",
  tagline: "",
  yearsOfExperience: 0,
  email: SITE.contactEmail,
  websites: { alternative: "", portfolio: "https://hmziq.rs", cv: "" },
  social: { github: "hmziqrs", linkedin: "hmziqrs", twitter: "hmziqrs", instagram: "hmziqrs" },
};

let cached: { profile: OwnerProfile; expires: number } | null = null;
let inflight: Promise<OwnerProfile> | null = null;

// eslint-disable-next-line anti-slop/no-unknown-parameters -- boundary parser for untrusted OWNER_SOURCE_URL JSON; callers pass raw res.json() output
function isOwnerProfile(d: unknown): d is Pick<OwnerProfile, "email" | "social"> {
  if (!d) return false;
  // SAFETY: d is raw fetch JSON that only passed a truthiness check; the cast exists solely to probe fields whose representations are verified on the next line.
  const candidate = d as OwnerProfile;
  // eslint-disable-next-line anti-slop/no-runtime-typeof -- probes the runtime representation of untyped JSON fields at the fetch boundary
  return typeof candidate.email === "string" && typeof candidate.social?.twitter === "string";
}

export async function fetchOwnerProfile(opts?: { force?: boolean }): Promise<OwnerProfile> {
  if (!opts?.force && cached && cached.expires > Date.now()) return cached.profile;

  if (!inflight || opts?.force) {
    inflight = (async () => {
      try {
        const res = await fetchWithTimeout(OWNER_SOURCE_URL, { timeout: FETCH_TIMEOUT_MS });
        if (!res.ok) throw new Error(`owner fetch HTTP ${res.status}`);
        const data: unknown = await res.json();
        if (!isOwnerProfile(data)) throw new Error("owner payload shape invalid");
        // SAFETY: isOwnerProfile(data) verified email and social; Partial marks the remaining fields optional so FALLBACK_PROFILE fills them below.
        const partial = data as Partial<OwnerProfile>;
        const profile: OwnerProfile = {
          ...FALLBACK_PROFILE,
          ...partial,
          websites: { ...FALLBACK_PROFILE.websites, ...partial.websites },
          social: { ...FALLBACK_PROFILE.social, ...partial.social },
        };
        cached = { profile, expires: Date.now() + CACHE_TTL_MS };
        return cached.profile;
      } catch (err) {
        console.warn("[owner] fetch failed, using fallback profile:", err);
        cached = { profile: FALLBACK_PROFILE, expires: Date.now() + CACHE_TTL_MS };
        return FALLBACK_PROFILE;
      } finally {
        inflight = null;
      }
    })();
  }
  return inflight;
}

export async function getOwnerPublic(): Promise<OwnerPublic> {
  const p = await fetchOwnerProfile();
  return {
    email: p.email,
    x: `https://x.com/${p.social.twitter}`,
    xHandle: `@${p.social.twitter}`,
  };
}

export async function getOwnerProfile(): Promise<OwnerProfile> {
  return fetchOwnerProfile();
}
