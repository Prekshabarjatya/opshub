// Cloudflare deploy: `STATIC_EXPORT=1 next build` emits a fully static site into ./out
// (every OpsHub page renders in the browser and talks to the API directly, so no server is needed).
const isExport = process.env.STATIC_EXPORT === '1';

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  ...(isExport
    ? { output: 'export' }
    : {
        // Local dev / `next start`. For the static export the same headers live in public/_headers.
        async headers() {
          return [
            {
              source: '/sw.js',
              headers: [
                { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
                { key: 'Service-Worker-Allowed', value: '/' },
              ],
            },
          ];
        },
      }),
};
