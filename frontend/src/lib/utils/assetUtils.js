/**
 * assetUtils.js
 * Utility functions for handling asset paths in the application
 */

/**
 * Get the correct path for static assets, with fallbacks for different environments
 * This helps handle path differences between development and production builds
 * 
 * @param {string} filename - The filename of the asset
 * @returns {string} The resolved asset path
 */
export function getAssetPath(filename) {
  // Try multiple possible locations
  const possiblePaths = [
    `./static/${filename}`,      // Main location in distribution build
    `./${filename}`,             // Root of distribution
    `/static/${filename}`,       // Absolute path from root
    `../static/${filename}`,     // Parent directory
    `./assets/${filename}`       // Backup location
  ];
  
  // In a real application, we would check if files exist
  // But in the browser, we'll use the first path and rely on onerror for fallbacks
  return possiblePaths[0];
}

/**
 * Creates an image element with fallback sources
 * This helps prevent broken image links in different environments
 * 
 * @param {string} filename - The filename of the image
 * @param {string} altText - Alt text for the image
 * @param {string} className - Optional CSS class for the image
 * @returns {HTMLImageElement} The image element
 */
export function createImageWithFallbacks(filename, altText, className = '') {
  const img = document.createElement('img');
  img.alt = altText || filename;
  if (className) img.className = className;
  
  // Set primary source
  img.src = getAssetPath(filename);
  
  // Set fallback logic
  img.onerror = function() {
    // Try alternate paths if the first one fails
    const fallbacks = [
      `./${filename}`,
      `/static/${filename}`,
      `./assets/${filename}`
    ];
    
    let fallbackIndex = 0;
    
    const tryNextFallback = () => {
      if (fallbackIndex < fallbacks.length) {
        img.src = fallbacks[fallbackIndex];
        fallbackIndex++;
      } else {
        // No more fallbacks available, use a placeholder or hide
        console.warn(`Failed to load image: ${filename}`);
        img.style.display = 'none';
      }
    };
    
    img.onerror = tryNextFallback;
    tryNextFallback();
  };
  
  return img;
}

/**
 * Generate the appropriate onerror handler for HTML img tags
 * For use in Svelte components directly in the template
 * 
 * @param {string} filename - The filename of the image
 * @returns {string} onerror attribute content
 */
export function getImageFallbackHandler(filename) {
  return `this.onerror=null; 
  const fallbacks=['./static/${filename}', './${filename}', '/static/${filename}', './assets/${filename}']; 
  let i=0; 
  const tryNext=()=>{if(i<fallbacks.length){this.src=fallbacks[i++];}else{console.warn('Failed to load: ${filename}');this.style.display='none';}};
  this.onerror=tryNext; 
  tryNext();`;
}