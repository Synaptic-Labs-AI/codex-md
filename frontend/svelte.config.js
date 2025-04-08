import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'dist',
      assets: 'dist',
      fallback: 'index.html',
      strict: false,
      precompress: false
    }),
    paths: {
      base: '',
      assets: '',
      relative: true
    },
    alias: {
      '@shared': '../shared/src'
    }
  },
  preprocess: vitePreprocess()
};

export default config;
