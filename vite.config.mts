import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  envDir: '..',
  publicDir: false,
  base: process.env.VITE_BASE_PATH || '/',
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    license: { fileName: 'licenses.md' }
  }
});
