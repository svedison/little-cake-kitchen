import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under the repo name.
  base: process.env.GITHUB_ACTIONS ? '/little-cake-kitchen/' : '/',
  build: { target: 'es2022' },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
