import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH serves the app from a sub-folder, e.g. /ficsit_planner/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from src/components/PwaStatus.tsx so the app can say when it's ready offline.
      injectRegister: false,
      manifest: {
        name: 'FICSIT Planner',
        short_name: 'FICSIT',
        description: 'Offline production planner for Satisfactory: pick what to make, get the machines, belts and power.',
        lang: 'en',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        theme_color: '#141618',
        background_color: '#141618',
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
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
