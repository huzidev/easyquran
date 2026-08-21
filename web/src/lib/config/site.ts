export const SITE = {
  name: "EasyQuran",
  domain: "easyquran.fyi",
  url: "https://easyquran.fyi",
  github: "https://github.com/hmziqrs",
  maker: "oxlabs",
  makerUrl: "https://oxlabs.dev",
  owner: "hmziq.rs",
  ownerUrl: "https://hmziq.rs",
  contactEmail: "hmziqrs@gmail.com",
  tanzilUrl: "https://tanzil.net",
} as const;

import { dev } from "$app/environment";
import { env } from "$env/dynamic/public";
import {
  QuranDataEnvironment,
  resolveQuranArtifactBase,
  resolveQuranDataEnvironment,
} from "$lib/quran/environment";
import { registeredSourceProfiles } from "$lib/quran/view/source-profiles";

const PUBLIC_API_BASE = (env.PUBLIC_QURAN_API_BASE ?? "").replace(/\/+$/, "");
const QURAN_DATA_ENVIRONMENT = resolveQuranDataEnvironment(
  env.PUBLIC_ENV,
  dev ? QuranDataEnvironment.Local : QuranDataEnvironment.Production,
);
const QURAN_ARTIFACT_BASE = resolveQuranArtifactBase(QURAN_DATA_ENVIRONMENT);

const QURAN_ARTIFACTS = Object.freeze(
  registeredSourceProfiles().map((profile) => ({
    id: profile.sourceId,
    sizeBytes: profile.artifact.sizeBytes,
    downloadUrl: `${QURAN_ARTIFACT_BASE}/${profile.artifact.r2Path}`,
  })),
);

export const QURAN = {
  apiBase: PUBLIC_API_BASE,
  dataEnvironment: QURAN_DATA_ENVIRONMENT,
  artifactBase: QURAN_ARTIFACT_BASE,
  scripts: QURAN_ARTIFACTS,
} as const;

export type ThemeMode = "dark" | "light";
export type AccentId = "emerald" | "gold" | "azure" | "plum";
export type SurfaceId = "ink" | "paper" | "slate" | "mocha" | "contrast";

export interface AccentDef {
  id: AccentId;
  hex: string;
}

export const ACCENTS: AccentDef[] = [
  { id: "emerald", hex: "#3fbfa6" },
  { id: "gold", hex: "#d9af6a" },
  { id: "azure", hex: "#6fb0e8" },
  { id: "plum", hex: "#c08cff" },
];

export interface SurfaceDef {
  id: SurfaceId;
  darkHex: string;
  lightHex: string;
}

export const SURFACES: SurfaceDef[] = [
  {
    id: "ink",
    darkHex: "#0a0a0a",
    lightHex: "#ffffff",
  },
  {
    id: "paper",
    darkHex: "#151210",
    lightHex: "#faf6ef",
  },
  {
    id: "slate",
    darkHex: "#0d1117",
    lightHex: "#f6f8fa",
  },
  {
    id: "mocha",
    darkHex: "#17110e",
    lightHex: "#f7f1ea",
  },
  {
    id: "contrast",
    darkHex: "#000000",
    lightHex: "#ffffff",
  },
];

export interface ThemeDefaults {
  theme: ThemeMode;
  accent: AccentId;
  surface: SurfaceId;
}

export const DEFAULTS: ThemeDefaults = {
  theme: "dark",
  accent: "emerald",
  surface: "ink",
};
