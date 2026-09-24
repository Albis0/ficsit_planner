import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// App icons for the PWA manifest, favicon and iOS home screen, generated from public/logo.png.
// Run `bun run pwa-icons` after changing the logo and commit the files it writes to public/.
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#141618' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#141618' } },
  },
  images: ['public/logo.png'],
});
