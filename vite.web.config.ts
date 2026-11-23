import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

// Browser build of the very same renderer: the platform layer (src/renderer/src/platform) picks the
// web adapter at run time when the Electron bridge (window.ct) is absent. Output: a static site.
export default defineConfig({
  define,
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@core': resolve(__dirname, 'src/core'),
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  plugins: [
    react(),
    // The desktop CSP (no remote frames) is replaced by one that lets the official YouTube player in.
    {
      name: 'web-csp',
      transformIndexHtml: (html: string) =>
        html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.youtube.com https://s.ytimg.com${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; connect-src 'self' https://www.googleapis.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; worker-src 'self' blob:; font-src 'self' data:">`),
    },
  ],
  worker: { format: 'es' },
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true, target: 'es2022' },
});
