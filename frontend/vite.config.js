import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    host: true
  },
  resolve: {
    alias: {
      '@codex-md/shared': resolve(__dirname, '../shared/src')
    }
  },
  optimizeDeps: {
    exclude: ['@codex-md/shared']
  }
});
