// Static build for Cloudflare. Stamps a build id into the app and into out/version.json so
// already-open and installed copies notice a new deploy and reload themselves.
const { execSync } = require('child_process');
const fs = require('fs');

const id = String(Date.now());
execSync('next build', {
  stdio: 'inherit',
  env: { ...process.env, STATIC_EXPORT: '1', NEXT_PUBLIC_BUILD_ID: id },
});
// With a custom distDir, `next build` writes the static export there; wrangler uploads ./out.
fs.rmSync('out', { recursive: true, force: true });
fs.cpSync('.next-export', 'out', { recursive: true });
fs.writeFileSync('out/version.json', JSON.stringify({ id }));
console.log(`Build id ${id}`);
