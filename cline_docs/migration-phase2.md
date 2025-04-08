# Phase 2: Refactor Core Components and Stores

## Goal/Purpose
The purpose of this phase is to refactor the existing components and stores to work with plain Svelte instead of SvelteKit. This involves identifying and modifying SvelteKit-specific code in the existing files while maintaining the current functionality and structure as much as possible.

## Files to Edit

### Key Files to Modify
- `frontend/src/routes/+layout.svelte` → Adapt to become `frontend/src/App.svelte`
- `frontend/src/routes/+page.svelte` → Adapt to work with client-side routing
- `frontend/src/routes/about/+page.svelte` → Adapt to work with client-side routing
- `frontend/src/routes/help/+page.svelte` → Adapt to work with client-side routing
- `frontend/src/routes/settings/+page.svelte` → Adapt to work with client-side routing
- `frontend/src/lib/components/*.svelte` → Remove SvelteKit-specific imports and features
- `frontend/src/lib/stores/*.js` → Ensure compatibility with plain Svelte

### SvelteKit-Specific Code to Replace
- `$app/stores` imports (e.g., `page`)
- `$app/navigation` imports (e.g., `goto`)
- SvelteKit-specific lifecycle hooks
- Server-side code or endpoints

## Step-by-Step Instructions

### 1. Identify SvelteKit-Specific Code

First, scan through the codebase to identify all SvelteKit-specific code that needs to be replaced:

```bash
# Search for SvelteKit imports
grep -r "from '\$app" frontend/src/
grep -r "from \"$app" frontend/src/

# Search for SvelteKit hooks
grep -r "export const load" frontend/src/
grep -r "export async function load" frontend/src/
```

### 2. Create Routes Configuration

**Create `frontend/src/routes.js` to define client-side routes**

```javascript
// Import existing page components directly from their current locations
import Home from './routes/+page.svelte';
import About from './routes/about/+page.svelte';
import Help from './routes/help/+page.svelte';
import Settings from './routes/settings/+page.svelte';

// Define routes mapping
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

### 3. Transform Layout to App Component

**Transform `frontend/src/routes/+layout.svelte` into `frontend/src/App.svelte`**

```svelte
<script>
  // Replace SvelteKit imports
  // Before:
  // import { page } from '$app/stores';
  
  // After:
  import Router from 'svelte-spa-router';
  import { routes } from './routes';
  import { onMount } from 'svelte';
  
  // Keep existing imports for components
  import OfflineStatusBar from './lib/components/OfflineStatusBar.svelte';
  
  // Keep existing store imports and logic
  import { welcomeState } from './lib/stores/welcomeState';
  
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

<!-- Replace <slot /> with Router component -->
<main>
  <OfflineStatusBar />
  <div class="app-container">
    <Router {routes} />
  </div>
</main>

<!-- Keep existing styles -->
<style>
  /* Copy styles from +layout.svelte */
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

### 4. Refactor Page Components

**Refactor `frontend/src/routes/+page.svelte`**

```svelte
<script>
  // Replace SvelteKit imports
  // Before:
  // import { page } from '$app/stores';
  // import { goto } from '$app/navigation';
  
  // After:
  import { push, location } from 'svelte-spa-router';
  
  // Keep existing component imports
  import CodexMdConverter from '../lib/components/CodexMdConverter.svelte';
  
  // Replace any navigation functions
  function navigateTo(path) {
    push(path);
  }
  
  // Keep the rest of the component logic
</script>

<!-- Keep the existing template -->
<div class="home-container">
  <CodexMdConverter />
</div>

<!-- Keep existing styles -->
<style>
  /* Copy existing styles */
</style>
```

Apply similar changes to other page components:
- `frontend/src/routes/about/+page.svelte`
- `frontend/src/routes/help/+page.svelte`
- `frontend/src/routes/settings/+page.svelte`

### 5. Refactor Components with SvelteKit Dependencies

**Example: Refactoring a component that uses SvelteKit navigation**

```svelte
<script>
  // Before:
  // import { goto } from '$app/navigation';
  
  // After:
  import { push } from 'svelte-spa-router';
  
  // Replace navigation function
  function handleNavigation(path) {
    // Before: goto(path);
    // After:
    push(path);
  }
</script>
```

**Example: Refactoring a component that uses SvelteKit page store**

```svelte
<script>
  // Before:
  // import { page } from '$app/stores';
  // let currentPath = $page.url.pathname;
  
  // After:
  import { location } from 'svelte-spa-router';
  
  // Use the location store instead
  let currentPath;
  $: currentPath = $location;
</script>
```

### 6. Refactor API Calls

**For components that use SvelteKit endpoints:**

```svelte
<script>
  // Before:
  // async function fetchData() {
  //   const response = await fetch('/api/data');
  //   return await response.json();
  // }
  
  // After:
  import { apiClient } from '../lib/api/client';
  
  async function fetchData() {
    return await apiClient.getData();
  }
</script>
```

### 7. Update Store Implementations if Needed

Most Svelte stores should work without changes, but check for any SvelteKit-specific dependencies:

```javascript
// Before:
// import { browser } from '$app/environment';
// if (browser) { ... }

// After:
const isBrowser = typeof window !== 'undefined';
if (isBrowser) { ... }
```

### 8. Create Main Entry Point

**Create `frontend/src/main.js` as the new entry point**

```javascript
import './lib/styles/global.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')
});

export default app;
```

### 9. Test Component Refactoring

After refactoring each component, test it to ensure it works correctly:

1. Check that navigation works between pages
2. Verify that components render correctly
3. Test any interactive features
4. Ensure stores are properly initialized and updated

This incremental approach allows you to refactor the application while maintaining its functionality and structure.
