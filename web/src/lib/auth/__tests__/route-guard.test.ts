import { describe, expect, it } from "vite-plus/test";
import { guestOnlyRedirect, protectedRouteRedirect } from "../route-guard";

const verified = {
  id: 1,
  name: "Amina",
  email: "amina@example.test",
  avatar_id: null,
  is_verified: true,
  role: "user",
  two_fa_enabled: false,
  oauth_provider: null,
};

const unverified = { ...verified, is_verified: false };

describe("guestOnlyRedirect", () => {
  it("redirects authenticated users away from sign-in and registration", () => {
    expect(guestOnlyRedirect("/login", "authenticated", verified)).toBe("/app");
    expect(guestOnlyRedirect("/register", "authenticated", unverified)).toBe("/verify-email");
  });

  it("redirects authenticated users away from forgot-password (409 guard on the API)", () => {
    expect(guestOnlyRedirect("/forgot-password", "authenticated", verified)).toBe("/app");
  });

  it("leaves guests and non-guest-only auth routes alone", () => {
    expect(guestOnlyRedirect("/login", "anonymous", null)).toBeNull();
    expect(guestOnlyRedirect("/verify-email", "authenticated", verified)).toBeNull();
  });
});

describe("protectedRouteRedirect", () => {
  it("sends anonymous visitors to sign in without redirecting unresolved sessions", () => {
    expect(protectedRouteRedirect("anonymous")).toBe("/login");
    expect(protectedRouteRedirect("unknown")).toBeNull();
    expect(protectedRouteRedirect("authenticated")).toBeNull();
  });
});
