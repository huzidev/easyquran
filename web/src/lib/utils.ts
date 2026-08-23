import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatBytes(n: number | null): string {
  if (n == null || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${(n / 1024 ** 4).toFixed(1)} TB`;
}

export type ExternalLinkAttrs = { target?: "_blank"; rel?: string };

export function externalLinkAttrs(
  href?: string,
  opts: { me?: boolean } = {},
): ExternalLinkAttrs {
  if (href !== undefined && /^https?:\/\//i.test(href)) {
    return {
      target: "_blank",
      rel: opts.me ? "me noopener noreferrer" : "noopener noreferrer",
    };
  }
  return {};
}

export type WithElementRef<T, U = HTMLElement> = T & { ref?: U | null; elementref?: U | null };
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, "child"> : T;
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, "children"> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
