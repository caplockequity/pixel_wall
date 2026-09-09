import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export async function standaloneConfig({ sourceRoot = process.env.PIXELWALL_SOURCE_ROOT ?? resolve(here, '..'), outDir = resolve(sourceRoot, 'dist/standalone') } = {}) {
  // Every distributed copy links to the public project, including private previews.
  const storefront = new URL('https://www.pixelwall.dev');
  if (storefront.protocol !== 'https:') throw new Error('Standalone checkout requires an explicit HTTPS storefront URL.');
  let publicKeys = {};
  try { publicKeys = (await import(pathToFileURL(resolve(sourceRoot, 'app/license-public-keys.mjs')).href)).PINNED_PUBLIC_KEYS ?? {}; } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  if (Object.values(publicKeys).some((key) => key?.d || key?.kty !== 'EC' || key?.crv !== 'P-256')) throw new Error('The distribution key map must contain public P-256 verification keys only.');
  return defineConfig({
    configFile: false, root: here, base: './', publicDir: false,
    envDir: false, envPrefix: 'PIXELWALL_NO_AUTOMATIC_CLIENT_ENV_',
    plugins: [react()],
    resolve: { alias: {
      './analytics': resolve(here, 'analytics.mjs'),
      '@pixelwall/workbench': resolve(sourceRoot, 'app/workbench.jsx'),
      '@pixelwall/globals.css': resolve(sourceRoot, 'app/globals.css'),
      '@pixelwall/dialogs.css': resolve(sourceRoot, 'app/editor/studio.css'),
      '@pixelwall/workbench.css': resolve(sourceRoot, 'app/editor/workbench.css'),
    } },
    define: {
      'process.env.NEXT_PUBLIC_PIXELWALL_STANDALONE': JSON.stringify('true'),
      'process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN': JSON.stringify(''),
      'process.env.NEXT_PUBLIC_POSTHOG_HOST': JSON.stringify(''),
      'process.env.NEXT_PUBLIC_PIXELWALL_SITE_URL': JSON.stringify(storefront.origin),
      'process.env.NEXT_PUBLIC_PIXELWALL_LICENSE_PUBLIC_KEYS': JSON.stringify(JSON.stringify(publicKeys)),
      'process.env.NEXT_PUBLIC_PIXELWALL_LICENSE_MODE': JSON.stringify('live'),
    },
    css: { postcss: resolve(sourceRoot) },
    build: { outDir, emptyOutDir: true, sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 900, manifest: true },
  });
}
export default standaloneConfig();
