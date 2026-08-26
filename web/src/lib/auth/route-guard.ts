import type { AuthStatus } from "./auth-state.svelte";
import { postAuthPath } from "./post-auth-path";
import type { UserProfile } from "./auth-client";

const GUEST_ONLY_PATHS = new Set(["/login", "/register", "/forgot-password"]);

export function guestOnlyRedirect(
  pathname: string,
  status: AuthStatus,
  user: UserProfile | null,
): "/app" | "/verify-email" | null {
  if (status !== "authenticated") return null;
  if (!GUEST_ONLY_PATHS.has(pathname)) return null;
  return postAuthPath(user);
}

export function protectedRouteRedirect(status: AuthStatus): "/login" | null {
  if (status === "anonymous") return "/login";
  return null;
}
