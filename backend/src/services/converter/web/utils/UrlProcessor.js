/**
 * URL Processing Module for Web Content
 */

/**
 * Get the domain name from a URL
 * @param {string} url - URL to process
 * @returns {string} Domain name
 */
function getDomain(url) {
  try {
    if (!url) return '';
    const parsed = new URL(url);
    return parsed.hostname;
  } catch (e) {
    return '';
  }
}

/**
 * Check if URL is external to a base domain
 * @private
 */
function isExternalUrl(url, baseDomain) {
  if (!url || !baseDomain) return false;
  
  try {
    // Handle special cases - fragments and relative paths are always internal
    if (url.startsWith('#') || url.startsWith('/')) {
      return false;
    }

    // Don't try to process fragments as URLs
    if (url.includes('#')) {
      // If URL contains a fragment, check only the part before the fragment
      const urlWithoutFragment = url.split('#')[0];
      if (!urlWithoutFragment) return false;
      
      const urlDomain = getDomain(urlWithoutFragment);
      return urlDomain && urlDomain !== baseDomain;
    }

    // Check for valid URL
    const urlDomain = getDomain(url);
    return urlDomain && urlDomain !== baseDomain;
  } catch (e) {
    console.warn(`Error checking if URL is external: ${url}`, e);
    return false;
  }
}

/**
 * Process URLs for proper formatting and resolution
 * @private
 */
function processUrl(url, baseUrl = '') {
  try {
    // Handle special cases
    if (!url) return '';
    
    // Keep fragment links as-is - don't try to process them as URLs
    if (url.startsWith('#')) {
      return url;
    }

    // Keep relative paths starting with /
    if (url.startsWith('/')) {
      return url;
    }

    // Handle absolute URLs
    if (url.match(/^https?:\/\//i)) {
      return url;
    }

    // Handle mailto: links
    if (url.startsWith('mailto:')) {
      return url;
    }

    // Resolve relative URLs against base URL
    if (baseUrl) {
      try {
        return new URL(url, baseUrl).toString();
      } catch (e) {
        console.warn(`Failed to resolve relative URL: ${url} against base: ${baseUrl}`);
        return url;
      }
    }

    return url;
  } catch (e) {
    console.warn(`Error processing URL: ${url}`, e);
    return url;
  }
}

/**
 * Format link with appropriate markup
 * @param {string} text - Link text
 * @param {string} url - Link URL
 * @param {Object} options - Formatting options
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {string} Formatted link
 */
export function formatLink(text, url, options = {}, baseUrl = '') {
  if (!url) return text;
  
  try {
    // Special handling for fragment identifiers
    if (url.startsWith('#')) {
      // Format fragment links for Obsidian - remove the # and use the text or fragment name
      const linkText = text || url.substring(1);
      return `[[${linkText}]]`;
    }
    
    const processedUrl = processUrl(url, baseUrl);
    const linkText = text || processedUrl;
    
    // External link handling
    const baseDomain = getDomain(baseUrl);
    if (isExternalUrl(processedUrl, baseDomain)) {
      return options.externalLinkStyle === 'reference' ?
        `[${linkText}][${processedUrl}]` :
        `[${linkText}](${processedUrl})`;
    }
    
    // Internal link handling (Obsidian style)
    if (processedUrl.startsWith('/')) {
      return `[[${linkText}]]`;
    }
    
    // Default link format
    return `[${linkText}](${processedUrl})`;
  } catch (e) {
    console.warn('Error formatting link:', e);
    return text || url;
  }
}

export default {
  formatLink,
  processUrl,
  getDomain,
  isExternalUrl
};
