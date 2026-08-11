import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * base: './'
 * ---------
 * The build is inlined into a single `dist/index.html` by vite-plugin-singlefile,
 * so there are no hashed asset URLs left to resolve. The only remaining relative
 * references are the PWA files copied from `public/` (manifest + service worker +
 * icon). A relative base keeps those working BOTH for GitHub Project Pages
 * (served from https://<user>.github.io/gym-rpg/) and for the single file opened
 * straight from disk via file:// — an absolute base of '/gym-rpg/' would break
 * the file:// case, and '/' would break Pages.
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: 'es2022',
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
