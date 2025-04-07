/**
 * URL Converter Configuration Module
 * 
 * This module provides configuration settings for the URL converter.
 * It includes constants and settings used by the other utility modules.
 * 
 * Related files:
 * - ../urlConverter.js: Main URL converter implementation
 * - ./spaHandler.js: SPA detection and handling
 * - ./contentExtractor.js: Content extraction logic
 * - ./htmlToMarkdown.js: HTML to Markdown conversion
 */

/**
 * Default HTTP request options
 */
export const DEFAULT_HTTP_OPTIONS = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  },
  timeout: 30000,
  retry: 2,
  decompress: true,
  responseType: 'text'
};

/**
 * Default content selectors in order of priority
 * These are used to find the main content of a page
 */
export const DEFAULT_CONTENT_SELECTORS = [
  // Body as fallback (highest priority to ensure we get everything if needed)
  'body',
  
  // Common article/content containers
  'article',
  'main',
  '.article',
  '.post',
  '.content',
  '.main-content',
  '.entry-content',
  '.post-content',
  '.article-content',
  '.blog-post',
  '.blog-content',
  
  // Modern framework root elements
  '#root',
  '#app',
  '#__next',
  '#gatsby-focus-wrapper',
  '#svelte',
  '#nuxt',
  '[data-reactroot]',
  '[data-react-app]',
  '[data-vue-app]',
  '[data-svelte]',
  '[data-angular-app]',
  
  // Modern component patterns
  '.page',
  '.page-container',
  '.page-content',
  '.page-wrapper',
  '.view',
  '.view-container',
  '.component',
  '.component-container',
  '.layout',
  '.layout-container',
  
  // Common UI patterns
  '.hero',
  '.hero-section',
  '.banner',
  '.banner-section',
  '.jumbotron',
  '.showcase',
  '.feature',
  '.feature-section',
  '.features',
  '.pricing',
  '.pricing-section',
  '.pricing-table',
  '.pricing-plans',
  '.cards',
  '.card-container',
  '.card-section',
  '.grid',
  '.grid-container',
  '.flex-container',
  '.columns',
  '.rows',
  
  // Documentation specific
  '.documentation',
  '.docs',
  '.doc-content',
  '.markdown-body',
  '.readme',
  
  // Wiki specific
  '.wiki-content',
  '.wiki-body',
  '.mw-parser-output',
  
  // Forum specific
  '.forum-post',
  '.forum-content',
  '.message-body',
  '.post-message',
  
  // Generic content containers
  '#content',
  '#main',
  '.container',
  '.container-fluid',
  '.site-content',
  
  // Fallbacks
  'section',
  '.section',
  '#primary',
  '.primary',
  '.middle',
  '.center',
  '.wrapper',
  '.inner',
  '.body',
  
  // Specific content sections
  '[role="main"]',
  '[role="article"]',
  '[role="contentinfo"]',
  '[role="region"]',
  '[data-content]',
  '[data-main]',
  '[data-page]',
  '[data-article]',
  
  // Tailwind CSS patterns
  '.prose',
  '.mx-auto',
  '.container',
  '.content-wrapper',
  
  // Bootstrap patterns
  '.container',
  '.container-fluid',
  '.row',
  '.col',
  '.card',
  '.card-body',
  '.jumbotron',
  
  // Material UI patterns
  '.MuiContainer-root',
  '.MuiGrid-root',
  '.MuiCard-root',
  '.MuiCardContent-root',
  '.MuiPaper-root',
  
  // Chakra UI patterns
  '.chakra-container',
  '.chakra-stack',
  '.chakra-card',
  '.chakra-box',
  
  // Ant Design patterns
  '.ant-layout-content',
  '.ant-card',
  '.ant-card-body',
  
  // Semantic UI patterns
  '.ui.container',
  '.ui.segment',
  '.ui.card',
  '.ui.grid'
];

/**
 * Cookie-related patterns for removal
 */
export const COOKIE_PATTERNS = {
  selectors: [
    // Cookie consent dialogs
    '#onetrust-banner-sdk',
    '#onetrust-consent-sdk',
    '#cookiebanner',
    '#cookie-banner',
    '#cookie-notice',
    '#cookie-law-info-bar',
    '#cookie-consent',
    '.cookie-consent',
    // GDPR notices
    '#gdpr-banner',
    '#gdpr-notice',
    '.gdpr-banner',
    // Common class patterns
    '[class*="cookie-banner"]',
    '[class*="cookie-dialog"]',
    '[class*="cookie-notice"]',
    '[class*="consent-banner"]',
    // Common ID patterns
    '[id*="cookie-banner"]',
    '[id*="cookie-dialog"]',
    '[id*="cookie-notice"]',
    '[id*="consent-banner"]'
  ],
  buttons: [
    '#onetrust-accept-btn-handler',
    '#accept-cookie-consent',
    '[id*="accept-cookies"]',
    '[id*="accept-cookie"]',
    '[id*="accept-consent"]',
    '.accept-cookies',
    '.accept-cookie',
    'button[contains(text(), "Accept")]',
    'button[contains(text(), "Accept All")]',
    'button[contains(text(), "Allow")]'
  ]
};

/**
 * Default exclude selectors
 */
export const DEFAULT_EXCLUDE_SELECTORS = [
  // Navigation
  'nav',
  'header',
  'footer',
  '.nav',
  '.navigation',
  '.menu',
  '.header',
  '.footer',
  '.breadcrumbs',
  
  // Sidebars
  'aside',
  '.sidebar',
  '.side-bar',
  '.widget',
  '.widgets',
  
  // Comments
  '.comments',
  '.comment-section',
  '#comments',
  '.disqus',
  
  // Social sharing
  '.share',
  '.social',
  '.social-share',
  '.sharing',
  
  // Ads
  '.ad',
  '.ads',
  '.advertisement',
  '.advert',
  '.banner',
  '.sponsored',
  '.promotion',
  
  // Related content
  '.related',
  '.recommended',
  '.suggestions',
  '.more-articles',
  '.more-posts',
  
  // Popups and overlays
  '.popup',
  '.modal',
  '.overlay',
  '.cookie-notice',
  '.newsletter-signup',
  '.subscription',
  
  // Author info
  '.author-bio',
  '.author-info',
  '.about-author',
  
  // Tags and categories
  '.tags',
  '.categories',
  '.taxonomy',
  
  // Search
  '.search',
  '.search-form',
  
  // Pagination
  '.pagination',
  '.pager',
  '.page-navigation',
  
  // Utility elements
  '.print',
  '.email',
  '.bookmark',
  '.save',
  '.toolbar',
  
  // Scripts and styles
  'script',
  'style',
  'noscript',
  'iframe',
  
  // Cookie and consent related
  '[id*="cookie"]',
  '[class*="cookie"]',
  '[id*="consent"]',
  '[class*="consent"]',
  '[id*="gdpr"]',
  '[class*="gdpr"]',
  '#hs-eu-cookie-confirmation',
  '.hs-cookie-notification',
  
  // Popups and modals
  '[id*="popup"]',
  '[class*="popup"]',
  '[id*="modal"]',
  '[class*="modal"]',
  '[id*="dialog"]',
  '[class*="dialog"]',
  '[id*="overlay"]',
  '[class*="overlay"]',
  '[id*="banner"]',
  '[class*="banner"]',
  '[id*="notification"]',
  '[class*="notification"]',
  
  // Widget and dynamic content
  '[data-widget]',
  '[data-analytics]',
  '[data-tracking]',
  '[data-ad]',
  '[data-testid*="banner"]',
  '[data-testid*="popup"]',
  
  // JavaScript-specific elements
  '[onclick]',
  '[data-reactroot]',
  '[data-react-app]',
  '[data-react-component]',
  '[ng-app]',
  '[ng-controller]',
  '[v-app]',
  '[data-v-]',
  
  // HubSpot specific
  '[class*="hs-"]',
  '[id*="hs-"]',
  '[data-hs-]',
  '.hubspot-wrapper',
  '.hbspt-form',
  '.hs-form',
  '#hsForm',
  '.hs-cta-wrapper',
  '.hs-cta-button'
];

/**
 * Wait times for SPA content loading (in milliseconds)
 */
export const WAIT_TIMES = [500, 1000, 2000, 3000, 5000, 8000];

/**
 * Supported image extensions
 */
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif'
];

/**
 * Default URL converter options
 */
export const DEFAULT_URL_CONVERTER_OPTIONS = {
  http: { ...DEFAULT_HTTP_OPTIONS },
  got: { ...DEFAULT_HTTP_OPTIONS },
  contentSelectors: DEFAULT_CONTENT_SELECTORS,
  excludeSelectors: DEFAULT_EXCLUDE_SELECTORS,
  includeImages: true,
  includeMeta: true,
  handleDynamicContent: true,
  maxDepth: 1,
  maxPages: 10,
  followLinks: false,
  linkSelector: 'a[href]',
  sameHostOnly: true,
  includeOriginalUrl: true,
  timeout: 60000, // Overall timeout for the entire conversion process
  retryDelay: 1000,
  maxRetries: 3,
  // Add option to use body as fallback if no content is found with selectors
  useBodyFallback: true,
  // Minimum content length to consider valid (characters)
  minContentLength: 100,
  // Image handling options
  images: {
    // Array of trusted image CDN domains
    trustedCdnDomains: [
      'synapticlabs.ai',
      'cloudinary.com',
      'imgix.net',
      'cloudfront.net',
      'amazonaws.com',
      'akamaized.net',
      'fastly.net',
      'cdn.io'
    ],
    // Common image query parameters to preserve
    validQueryParams: [
      'width',
      'height',
      'w',
      'h',
      'size',
      'resize',
      'fit',
      'quality',
      'format',
      'auto',
      'name'
    ]
  }
};

/**
 * Default parent URL converter options
 */
export const DEFAULT_PARENT_URL_CONVERTER_OPTIONS = {
  ...DEFAULT_URL_CONVERTER_OPTIONS,
  followLinks: true,
  maxDepth: 2,
  maxPages: 20,
  linkSelector: 'a[href]:not([href^="#"]):not([href^="javascript:"]):not([href$=".pdf"]):not([href$=".zip"])',
  sameHostOnly: true,
  includeOriginalUrl: true,
  skipDuplicateContent: true,
  contentSimilarityThreshold: 0.8, // Skip pages with content similarity above this threshold
  skipUrlPatterns: [
    /\/login\//i,
    /\/signup\//i,
    /\/register\//i,
    /\/account\//i,
    /\/cart\//i,
    /\/checkout\//i,
    /\/privacy\//i,
    /\/terms\//i,
    /\/contact\//i,
    /\/about\//i,
    /\/search\//i,
    /\/tag\//i,
    /\/category\//i,
    /\/author\//i,
    /\/date\//i,
    /\/page\/\d+/i,
    /\?page=\d+/i,
    /\?p=\d+/i
  ]
};

export default {
  DEFAULT_HTTP_OPTIONS,
  DEFAULT_CONTENT_SELECTORS,
  DEFAULT_EXCLUDE_SELECTORS,
  WAIT_TIMES,
  IMAGE_EXTENSIONS,
  DEFAULT_URL_CONVERTER_OPTIONS,
  DEFAULT_PARENT_URL_CONVERTER_OPTIONS
};
