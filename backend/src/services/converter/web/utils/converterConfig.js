/**
 * Converter Configuration Module
 * Centralized configuration for web converters
 */

import path from 'path';
import { generateUrlFilename } from '@codex-md/shared/utils/files';

/**
 * Default image extensions to include in conversion
 */
export const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'
];

/**
 * Default options for URL converter
 */
export const DEFAULT_URL_CONVERTER_OPTIONS = {
  // Browser options
  browser: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      isLandscape: true
    }
  },
  
  // HTTP options
  http: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    },
    timeout: 30000
  },
  
  // Navigation options
  navigation: {
    waitUntil: 'networkidle2',
    timeout: 30000
  },
  
  // Content options
  content: {
    handleDynamicContent: true,
    handleSPA: true,
    cleanupJavaScript: true
  },

  // URL options
  url: {
    // Parameters to remove from URLs
    trackingParams: [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', '_ga', 'ref', 'source', 'campaign', '_hsenc', '_hsmi',
      'mc_cid', 'mc_eid', 'mkt_tok', 'trk', '_openstat', 'yclid', 'fb_action_ids',
      'action_object_map', 'action_type_map', 'action_ref_map', 'gs_l', 'pd_rd_r',
      'pd_rd_w', 'pd_rd_wg', 'pf_rd_p', 'pf_rd_r', 'qid', 'sr', 'spm', 'psc'
    ],
    // Remove fragments from URLs unless they're used for routing
    removeFragments: true,
    // Convert relative URLs to absolute
    resolveRelative: true,
    // Remove /index.html from URLs
    cleanupIndexFiles: true,
    // Handle trailing slashes consistently
    trailingSlash: 'add'
  },
  
  // Image options
  images: {
    includeImages: true,
    extensions: IMAGE_EXTENSIONS
  },
  
  // Metadata options
  metadata: {
    includeMeta: true
  },
  
  // Markdown options
  markdown: {
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
    includeImageAlt: true,
    includeImageTitle: true,
    // Options for link formatting
    links: {
      // Use wiki-style links for internal pages
      useWikiLinks: true,
      // Keep original URLs in link text if no meaningful text is available
      keepUrlAsText: true,
      // Clean link text by removing redundant parts
      cleanLinkText: true,
      // Preserve anchor links
      preserveAnchors: true
    }
  }
};

/**
 * Default options for parent URL converter
 */
export const DEFAULT_PARENT_URL_CONVERTER_OPTIONS = {
  ...DEFAULT_URL_CONVERTER_OPTIONS,
  
  // Parent URL specific options
  parentUrl: {
    concurrentLimit: 30,
    maxPages: 100,
    chunkSize: 50,
    
    // URL patterns to skip
    skipUrlPatterns: [
      /\.(css|js|json|xml|txt|pdf|zip|rar|gz|tar|7z|exe|dmg|iso|mp3|mp4|avi|mov|wmv|flv|swf|woff|woff2|eot|ttf|otf|svg|png|jpg|jpeg|gif|webp|ico|bmp|tiff|webm|wav|ogg|doc|docx|xls|xlsx|ppt|pptx)$/i,
      /\/wp-admin\//i,
      /\/wp-includes\//i,
      /\/wp-content\/plugins\//i,
      /\/wp-content\/themes\//i,
      /\/wp-json\//i,
      /\/feed\//i,
      /\/rss\//i,
      /\/atom\//i,
      /\/category\//i,
      /\/tag\//i,
      /\/author\//i,
      /\/page\/\d+\//i,
      /\/search\//i,
      /\/login\//i,
      /\/logout\//i,
      /\/register\//i,
      /\/cart\//i,
      /\/checkout\//i,
      /\/account\//i,
      /\/profile\//i,
      /\/dashboard\//i,
      /\/admin\//i,
      /\/api\//i,
      /\/cdn-cgi\//i,
      /\/comments\//i
    ]
  }
};

/**
 * Merge user options with default options
 * @param {Object} userOptions - User-provided options
 * @returns {Object} Merged options
 */
export function mergeOptions(userOptions = {}, isParentUrlConverter = false) {
  // Deep merge for nested objects
  const deepMerge = (target, source) => {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] instanceof Object && key in target && target[key] instanceof Object) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  };
  
  const defaultOptions = isParentUrlConverter ? 
    DEFAULT_PARENT_URL_CONVERTER_OPTIONS : 
    DEFAULT_URL_CONVERTER_OPTIONS;
  
  return deepMerge(defaultOptions, userOptions);
}

/**
 * Format metadata as YAML frontmatter
 * @param {Object} metadata - Metadata object
 * @returns {string} Formatted YAML frontmatter
 */
export function formatMetadata(metadata) {
  const lines = ['---'];

  // Filter out any image-related metadata
  const cleanedMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !key.toLowerCase().includes('image'))
  );

  for (const [key, value] of Object.entries(cleanedMetadata)) {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        lines.push(`${key}:`);
        value.forEach(item => lines.push(`  - ${item}`));
      }
    } else if (value !== null && value !== undefined && value !== '') {
      // Escape special characters and wrap values containing special chars in quotes
      const needsQuotes = /[:#\[\]{}",\n]/g.test(value.toString());
      const escapedValue = value.toString().replace(/"/g, '\\"');
      lines.push(`${key}: ${needsQuotes ? `"${escapedValue}"` : value}`);
    }
  }

  lines.push('---\n');
  return lines.join('\n');
}


/**
 * Extract a title from a URL
 * @param {string} url - URL to extract title from
 * @returns {string} Extracted title
 */
export function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const pathname = urlObj.pathname;
    
    // Extract the last part of the path
    let title = path.basename(pathname);
    
    // If it's empty or just a slash, use the hostname
    if (!title || title === '/' || title === 'index.html') {
      title = hostname;
    }
    
    // Remove file extension if present
    title = title.replace(/\.[^/.]+$/, '');
    
    // Convert dashes and underscores to spaces
    title = title.replace(/[-_]/g, ' ');
    
    // Capitalize words
    title = title
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    
    return title || 'Untitled';
  } catch (error) {
    console.error('Error extracting title from URL:', error);
    return 'Untitled';
  }
}
