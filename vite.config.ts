import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH serves the app from a sub-folder, e.g. /ficsit_planner/ on GitHub Pages.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
