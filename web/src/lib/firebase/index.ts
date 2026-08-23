import { browser } from "$app/environment";
import { env } from "$env/dynamic/public";
import type { FirebaseApp, FirebaseOptions } from "firebase/app";

export const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyBTlP0JPVdOxesSY1QtqFujW4OqmaUsoMg",
  authDomain: "easyquran-fyi.firebaseapp.com",
  projectId: "easyquran-fyi",
  storageBucket: "easyquran-fyi.firebasestorage.app",
  messagingSenderId: "679657424226",
  appId: "1:679657424226:web:3bdc96c4f984fb8294983b",
  measurementId: "G-ZYL6HY24W6",
};

export const isConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.appId);

export const FCM_VAPID_KEY = env.PUBLIC_FCM_VAPID_KEY || "";

export const isMessagingConfigured = isConfigured && Boolean(FCM_VAPID_KEY);

export const API_BASE_URL = (env.PUBLIC_API_BASE_URL || "").replace(/\/+$/, "");

export const ANALYTICS_DEBUG = false;

let app: FirebaseApp | null = null;
let appPromise: Promise<FirebaseApp | null> | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  return app;
}

export function initApp(): Promise<FirebaseApp | null> {
  if (!browser || !isConfigured) return Promise.resolve(null);
  if (!appPromise) {
    appPromise = (async () => {
      try {
        const { getApps, getApp, initializeApp } = await import("firebase/app");
        const core = getApps().length ? getApp() : initializeApp(firebaseConfig);
        app = core;
      } catch (err) {
        console.warn("[firebase] app failed to initialize:", err);
      }
      return app;
    })();
  }
  return appPromise;
}
