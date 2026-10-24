'use client';

import { useEffect } from 'react';

// Installed phone apps keep the old page in memory for days. Whenever the app comes back to the
// front (and every 5 minutes while open) compare the deployed build id and reload if it changed.
export default function UpdateCheck() {
  useEffect(() => {
    const current = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!current) return undefined; // local dev: nothing to compare
    let reloading = false;
    const check = async () => {
      if (reloading || document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/version.json', { cache: 'no-store' });
        const { id } = await res.json();
        if (id && id !== current) {
          reloading = true;
          window.location.reload();
        }
      } catch {
        /* offline: try again later */
      }
    };
    check();
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, []);
  return null;
}
