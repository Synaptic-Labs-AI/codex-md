/**
 * main.js - Application entry point
 * Initializes the Svelte application and mounts it to the DOM.
 * Also imports global styles and handles any necessary initialization.
 * 
 * Key responsibilities:
 * - Import global CSS
 * - Create and mount the root App component
 * - Set up any global initialization logic
 */

// Import global styles
import './lib/styles/global.css';

// Import root component
import App from './App.svelte';

// Create and mount the application
const app = new App({
  target: document.getElementById('app')
});

export default app;
