import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@core': resolve(__dirname, 'src/core'),
};

export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias },
    // index = app bridge; yt-guest = the YouTube player page's pipe (see main/chud/yt-player.ts)
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), 'yt-guest': resolve(__dirname, 'src/preload/yt-guest.ts') } } },
  },
  renderer: {
    define,
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { ...alias, '@': resolve(__dirname, 'src/renderer/src') } },
    plugins: [
      react(),
      // Dev server only: React Fast Refresh needs an inline preamble; production keeps the strict CSP.
      { name: 'dev-csp', apply: 'serve', transformIndexHtml: (html: string) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") },
    ],
    worker: { format: 'es' },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
