import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Public address of the site, for the canonical link, social previews, robots.txt and the sitemap.
// Include the sub-folder when BASE_PATH is set, e.g. https://you.github.io/ficsit_planner.
const SITE_URL = (process.env.SITE_URL ?? 'https://ficsit-planner.pages.dev').replace(/\/$/, '');

function seo(): Plugin {
  return {
    name: 'seo',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod></url>
</urlset>
`,
      });
    },
  };
}

// BASE_PATH serves the app from a sub-folder, e.g. /ficsit_planner/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    seo(),
    VitePWA({
      // A new version waits until the player says Reload (src/components/PwaStatus.tsx), so nothing reloads mid-edit
      // and a plain refresh can't leave them on the old one without knowing.
      registerType: 'prompt',
      // Registered from src/components/PwaStatus.tsx so the app can say when it's ready offline or updated.
      injectRegister: false,
      manifest: {
        id: './',
        name: 'FICSIT Planner',
        short_name: 'FICSIT',
        description: 'Offline production planner for Satisfactory: pick what to make, get the machines, belts and power.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#151516',
        background_color: '#151516',
        categories: ['games', 'utilities'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything, icons and the 3.5 MB solver wasm included, so the app works with no network at all.
        globPatterns: ['**/*.{js,css,html,wasm,webp,woff2,png,ico}'],
        // The map's close-up tiles (5 MB) are kept as they're looked at instead; the overview works offline from the start.
        globIgnores: ['404.html', 'map/4/**', 'map/5/**'],
        // Addresses under /api/ are the server's, not pages of the app.
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/map\/[45]\/\d+\/\d+\.webp$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 2000 } },
          },
        ],
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
