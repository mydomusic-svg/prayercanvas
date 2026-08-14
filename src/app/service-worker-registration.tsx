"use client";

import { useEffect } from "react";

// Registers the minimal shell service worker (public/sw.js) so the app is
// installable to the home screen on Android/Chrome. Renders nothing —
// purely a side effect on mount. Safe to no-op on browsers without SW
// support (older Safari versions, etc.) or when running over plain HTTP in
// local dev without a cert.
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Non-fatal — the app works fine without an installed SW, it just
      // won't get Android's automatic install prompt.
    });
  }, []);

  return null;
}
