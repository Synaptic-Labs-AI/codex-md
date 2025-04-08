import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  base: './', // Use relative paths for Electron compatibility
  server: {
    port: 5173,
    strictPort: true,
    host: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // Ensure assets use relative paths for Electron
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: undefined // Disable code splitting for Electron
      }
    }
  },
  resolve: {
    alias: {
      '$lib': resolve(__dirname, './src/lib'),
      '@lib': resolve(__dirname, './src/lib'),
      '@components': resolve(__dirname, './src/lib/components'),
      '@stores': resolve(__dirname, './src/lib/stores'),
      '@shared': resolve(__dirname, '../shared/src'),
      '@codex-md/shared': resolve(__dirname, '../shared/src')
    }
  },
  optimizeDeps: {
    exclude: ['@codex-md/shared']
  },
  // Special handling for static assets
  publicDir: 'static'
});
