# Phase 1: Convert SvelteKit to Plain Svelte + Vite

## Goal/Purpose
The purpose of this phase is to convert the existing SvelteKit application to a plain Svelte + Vite setup while maintaining the current functionality. This approach focuses on modifying the existing infrastructure rather than creating a new project from scratch, which will minimize disruption and allow for incremental changes.

## Files to Add/Edit/Delete

### Add
- `frontend/index.html` (new entry point for Vite)
- `frontend/src/main.js` (new entry point for Svelte)
- `frontend/src/App.svelte` (main app component)

### Edit
- `frontend/vite.config.js` (update for plain Svelte)
- `frontend/package.json` (update dependencies and scripts)
- `frontend/tsconfig.json` (if needed)
- `package.json` (root package.json for scripts)

### Delete
- `frontend/src/app.html` (SvelteKit specific)
- `frontend/src/hooks.server.js` (SvelteKit specific)
- `frontend/src/routes/+layout.svelte` (replace with standard layout)
- `frontend/src/routes/+page.js` (SvelteKit specific)

## Step-by-Step Instructions

### 1. Update Dependencies in frontend/package.json

**Edit `frontend/package.json`**

```json
{
  "name": "mdcodex-frontend",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.1.2",
    "@tsconfig/svelte": "^5.0.0",
    "svelte": "^4.2.19",
    "svelte-check": "^3.4.3",
    "svelte-preprocess": "^6.0.3",
    "typescript": "^5.7.2",
    "vite": "^5.0.0"
  },
  "dependencies": {
    "@codex-md/shared": "file:../shared",
    "svelte-spa-router": "^4.0.0",
    "skeleton-elements": "^4.0.1"
  }
}
```

### 2. Create HTML Entry Point

**Create `frontend/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/static/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codex MD</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
```

### 3. Update Vite Configuration

**Edit `frontend/vite.config.js`**

```javascript
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
    // Ensure assets use relative paths
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        manualChunks: undefined // Disable code splitting for Electron
      }
    }
  },
  resolve: {
    alias: {
      '@lib': resolve(__dirname, './src/lib'),
      '@components': resolve(__dirname, './src/lib/components'),
      '@stores': resolve(__dirname, './src/lib/stores'),
      '@shared': resolve(__dirname, '../shared/src')
    }
  },
  optimizeDeps: {
    exclude: ['@codex-md/shared']
  },
  // Special handling for static assets
  publicDir: 'static'
});
```

### 4. Create Main Entry Point

**Create `frontend/src/main.js`**

```javascript
import './lib/styles/global.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')
});

export default app;
```

### 5. Create Main App Component

**Create `frontend/src/App.svelte`**

```svelte
<script>
  import Router from 'svelte-spa-router';
  import { routes } from './routes';
  import { onMount } from 'svelte';
  import { welcomeState } from './lib/stores/welcomeState';
  import OfflineStatusBar from './lib/components/OfflineStatusBar.svelte';

  let hasSeenWelcome;
  
  // Subscribe to welcome state
  const unsubscribe = welcomeState.subscribe(state => {
    hasSeenWelcome = state.hasSeenWelcome;
  });
  
  onMount(() => {
    // Clean up subscription
    return () => {
      unsubscribe();
    };
  });
</script>

<main>
  <OfflineStatusBar />
  <div class="app-container">
    <Router {routes} />
  </div>
</main>

<style>
  .app-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 1rem;
  }
  
  main {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
```

### 6. Create Routes Configuration

**Create `frontend/src/routes.js`**

```javascript
// Import route components
import Home from './pages/Home.svelte';
import About from './pages/About.svelte';
import Help from './pages/Help.svelte';
import Settings from './pages/Settings.svelte';

// Define routes
export const routes = {
  // Home page
  '/': Home,
  
  // About page
  '/about': About,
  
  // Help page
  '/help': Help,
  
  // Settings page
  '/settings': Settings,
  
  // Catch-all route - redirect to home
  '*': Home
};
```

### 7. Create Pages Directory and Migrate Pages

**Create `frontend/src/pages` directory and migrate existing pages**

For example, create `frontend/src/pages/Home.svelte`:

```svelte
<script>
  // Import components from the existing app
  import CodexMdConverter from '../lib/components/CodexMdConverter.svelte';
</script>

<div class="home-container">
  <CodexMdConverter />
</div>

<style>
  .home-container {
    width: 100%;
  }
</style>
```

### 8. Update Root Package.json Scripts

**Edit root `package.json` scripts section**

```json
"scripts": {
  "start": "electron .",
  "dev": "npm run build:shared && cross-env NODE_ENV=development concurrently \"npm run dev:svelte\" \"npm run dev:electron\"",
  "dev:svelte": "cd frontend && npm run dev",
  "dev:electron": "electron-forge start",
  "build": "npm run build:shared && npm run build:svelte && npm run build:electron",
  "build:shared": "cd shared && npm run build",
  "build:svelte": "cd frontend && npm run build && node ../scripts/copy-static-assets.js",
  "prebuild:electron": "node scripts/cleanup-resources.js",
  "build:electron": "electron-builder",
  "package": "electron-forge package",
  "make": "npm run build:shared && npm run prebuild:electron && electron-builder --win",
  "lint": "eslint src/electron"
}
```

### 9. Install Required Dependencies

```bash
# Navigate to frontend directory
cd frontend

# Remove SvelteKit dependencies
npm uninstall @sveltejs/adapter-auto @sveltejs/adapter-static @sveltejs/kit

# Install required dependencies
npm install svelte-spa-router
npm install --save-dev @sveltejs/vite-plugin-svelte @tsconfig/svelte
```

### 10. Test the Basic Setup

```bash
# From project root
npm run dev
```

This should start the development server with the converted Svelte app. Verify that it loads correctly in the browser before proceeding to Phase 2.
