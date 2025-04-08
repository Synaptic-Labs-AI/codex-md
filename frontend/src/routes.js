/**
 * routes.js - Application routing configuration
 * Defines client-side routes for the application using svelte-spa-router.
 * Migrated from SvelteKit's routing to a single-page application approach.
 * 
 * Routes:
 * - / : Home/converter page
 * - /about : About page with application information
 * - /help : Help and documentation
 * - /settings : Application settings
 * 
 * Note: All components are loaded from the pages directory to maintain
 * clear separation between routes and component implementations.
 */

// Import route components
import Home from './pages/Home.svelte';
import About from './pages/About.svelte';
import Help from './pages/Help.svelte';
import Settings from './pages/Settings.svelte';

// Define routes
export const routes = {
  // Home page - main converter interface
  '/': Home,
  
  // About page - application information
  '/about': About,
  
  // Help page - user documentation and guides
  '/help': Help,
  
  // Settings page - application configuration
  '/settings': Settings,
  
  // Catch-all route - redirect to home
  '*': Home
};
