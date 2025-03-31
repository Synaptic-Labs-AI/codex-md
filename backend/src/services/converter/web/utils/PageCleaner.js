/**
 * Page Cleaner Module
 * Handles cleaning up web pages for content extraction
 */

export class PageCleaner {
  /**
   * Clean up a page by removing unwanted elements
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<void>}
   */
  async cleanupPage(page) {
    try {
      await page.evaluate(() => {
        // Log initial content structure
        console.log('Initial content structure:', {
          bodyLength: document.body.innerHTML.length,
          mainElements: document.querySelectorAll('main, article, [role="main"]').length,
          scripts: document.querySelectorAll('script').length
        });

        // Only remove non-content elements
        const cleanupSelectors = [
          // Tracking and analytics
          'script[src*="google-analytics"]',
          'script[src*="gtag"]',
          'script[src*="facebook"]',
          'script[src*="pixel"]',
          
          // Chat widgets and overlays
          'iframe[src*="chat"]',
          'iframe[src*="messenger"]',
          'iframe[src*="intercom"]',
          
          // Cookie notices that are overlays
          'div[class*="cookie-banner"]:not([class*="content"])',
          'div[id*="cookie-banner"]:not([id*="content"])',
          
          // Third party widgets
          '.intercom-lightweight-app',
          '.drift-frame-controller',
          '.fb-customerchat'
        ];
        
        cleanupSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            // Don't remove if it might be content
            const isContent = el.closest('main, article, [role="main"], [class*="content"], [id*="content"]');
            if (!isContent) {
              console.log(`Removing element: ${selector}`);
              el.remove();
            } else {
              console.log(`Preserving content element: ${selector}`);
            }
          });
        });

        // Clean attributes but preserve React props
        document.querySelectorAll('*').forEach(el => {
          Array.from(el.attributes).forEach(attr => {
            const name = attr.name;
            // Only remove non-React attributes
            if (name.startsWith('on') && 
                !name.startsWith('data-') && 
                !name.startsWith('react') && 
                !name.startsWith('aria-')) {
              el.removeAttribute(name);
            }
          });
        });

        // Log final structure
        console.log('Final content structure:', {
          bodyLength: document.body.innerHTML.length,
          mainElements: document.querySelectorAll('main, article, [role="main"]').length,
          remainingScripts: document.querySelectorAll('script').length
        });
      });
      
      // Clean JavaScript more carefully
      await page.evaluate(() => {
        // Only clean obvious non-React scripts
        const scripts = document.getElementsByTagName('script');
        Array.from(scripts).forEach(script => {
          const src = script.getAttribute('src') || '';
          const content = script.textContent || '';
          
          // Keep React-related scripts
          if (src.includes('react') || 
              src.includes('chunk') || 
              content.includes('React') || 
              content.includes('ReactDOM')) {
            return;
          }
          
          // Remove tracking and analytics scripts
          if (src.includes('analytics') || 
              src.includes('pixel') || 
              src.includes('tracking') || 
              content.includes('fbq(') || 
              content.includes('gtag(')) {
            script.remove();
          }
        });
      });
    } catch (error) {
      console.error('Error cleaning up page:', error);
      // Continue with extraction even if cleanup fails
    }
  }

  /**
   * Light cleanup that preserves most content
   * @param {Page} page - Puppeteer page object
   * @param {Object} options - Cleanup options
   * @returns {Promise<void>}
   */
  async thoroughCleanup(page, options = {}) {
    try {
      await page.evaluate(() => {
        // Only clean up known unwanted elements
        const cleanupElements = [
          // Ads and tracking
          'ins.adsbygoogle',
          'div[id*="google_ads"]',
          'div[id*="carbonads"]',
          
          // Third party widgets
          '.intercom-lightweight-app',
          '.drift-frame-controller',
          '.zopim',
          '.fb-like',
          
          // Specific tracking and analytics
          'script[src*="google-analytics"]',
          'script[src*="hotjar"]',
          'script[src*="analytics"]',
          
          // Generic cleanup - be conservative
          'link[rel="preload"]',
          'link[rel="prefetch"]',
          'meta[http-equiv="refresh"]'
        ];

        cleanupElements.forEach(selector => {
          document.querySelectorAll(selector).forEach(element => {
            try {
              // Don't remove if it's part of main content
              const isMainContent = element.closest('main, article, [role="main"]');
              if (!isMainContent) {
                element.remove();
              }
            } catch (e) {
              // Ignore removal errors
            }
          });
        });

        // Only clean empty text nodes
        const cleanup = (element) => {
          if (!element) return;
          
          // Remove empty text nodes
          Array.from(element.childNodes).forEach(node => {
            if (node.nodeType === 3 && !node.textContent.trim()) {
              node.remove();
            }
          });
        };
        
        cleanup(document.body);
      });
    } catch (error) {
      console.error('Error in thorough cleanup:', error);
    }
  }

  /**
   * Remove overlays, cookie notices, and popups
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<void>}
   */
  async removeOverlays(page) {
    try {
      await page.evaluate(() => {
         // First pass: try to find and click common close buttons
         const closeButtonSelectors = [
           'button[aria-label*="close" i]',
           'button[title*="close" i]',
           'button.close',
           'button.dismiss',
           'button.cookie-accept',
           'button.accept-cookies',
           'button.accept-all',
           'button.accept',
           'button.agree',
           'button.got-it',
           'button.understood',
           'button[id*="close" i]',
           'button[class*="close" i]',
           'a[aria-label*="close" i]',
           'a[title*="close" i]',
           'a.close',
           'a[id*="close" i]',
           'a[class*="close" i]',
           'div[aria-label*="close" i]',
           'div[role="button"][aria-label*="close" i]',
           'svg[aria-label*="close" i]',
           'span[aria-label*="close" i]',
           'i.fa-times',
           'i.fa-close',
           'i.close-icon'
         ];
         
         // Try to click close buttons
         closeButtonSelectors.forEach(selector => {
           document.querySelectorAll(selector).forEach(button => {
             try {
               console.log('Clicking close button:', selector);
               button.click();
             } catch (e) {
               // Ignore errors if button can't be clicked
             }
           });
         });
         
         // Wait a moment for any animations to complete
         setTimeout(() => {}, 500);
         
         // Second pass: remove overlay elements
         const overlayPatterns = [
           // Cookie-related
           '[id*="cookie" i]',
           '[class*="cookie" i]',
           '[id*="consent" i]',
           '[class*="consent" i]',
           '[id*="gdpr" i]',
           '[class*="gdpr" i]',
           '[id*="privacy" i]',
           '[class*="privacy-banner" i]',
           // Popups and modals
           '[id*="popup" i]',
           '[class*="popup" i]',
           '[role="dialog"]',
           '[aria-modal="true"]',
           '[class*="modal" i]',
           '[id*="modal" i]',
           // Notifications and banners
           '[id*="banner" i]',
           '[class*="banner" i]',
           '[id*="notification" i]',
           '[class*="notification" i]',
           '[id*="alert" i]',
           '[class*="alert" i]',
           // Common overlay patterns
           '[class*="overlay" i]',
           '[id*="overlay" i]',
           '[class*="lightbox" i]',
           '[id*="lightbox" i]',
           // Newsletter and subscription
           '[class*="newsletter" i]',
           '[id*="newsletter" i]',
           '[class*="subscribe" i]',
           '[id*="subscribe" i]',
           '[class*="signup" i]',
           '[id*="signup" i]',
           // Paywalls
           '[class*="paywall" i]',
           '[id*="paywall" i]',
           '[class*="premium" i]',
           '[id*="premium-overlay" i]',
           // Chat widgets
           '[id*="chat-widget" i]',
           '[class*="chat-widget" i]',
           '[id*="livechat" i]',
           '[class*="livechat" i]',
           '[id*="intercom" i]',
           '[class*="intercom" i]',
           '[id*="drift" i]',
           '[class*="drift" i]',
           '[id*="zendesk" i]',
           '[class*="zendesk" i]',
           // Feedback widgets
           '[id*="feedback" i]',
           '[class*="feedback" i]',
           '[id*="survey" i]',
           '[class*="survey" i]'
         ];
 
         overlayPatterns.forEach(pattern => {
           document.querySelectorAll(pattern).forEach(element => {
             // Check if it's likely an overlay
             const style = window.getComputedStyle(element);
             const position = style.position;
             const zIndex = parseInt(style.zIndex, 10);
             const opacity = parseFloat(style.opacity);
             const visibility = style.visibility;
             const display = style.display;
             
             // More comprehensive check for overlay-like elements
             const isOverlayPosition = position === 'fixed' || position === 'absolute';
             const isHighZIndex = !isNaN(zIndex) && zIndex > 10;
             const isVisible = opacity !== 0 && visibility !== 'hidden' && display !== 'none';
             const isDialog = element.matches('[role="dialog"]') || element.matches('[aria-modal="true"]');
             const isFullScreenOverlay = (element.offsetWidth > window.innerWidth * 0.5) &&
                                        (element.offsetHeight > window.innerHeight * 0.3);
             
             // Remove if it looks like an overlay
             if (isVisible && (
                 (isOverlayPosition && isHighZIndex) ||
                 isDialog ||
                 (isOverlayPosition && isFullScreenOverlay)
             )) {
               console.log('Removing overlay:', pattern);
               element.remove();
             }
           });
         });
 
         // Remove body classes that might prevent scrolling
         const scrollBlockingPatterns = [
           'modal-open',
           'no-scroll',
           'noscroll',
           'overflow-hidden',
           'overflow-disable',
           'scroll-disabled',
           'scroll-locked',
           'fixed',
           'freeze',
           'frozen'
         ];
         
         // Check each class on the body
         const classList = Array.from(document.body.classList);
         classList.forEach(className => {
           if (scrollBlockingPatterns.some(pattern => className.toLowerCase().includes(pattern))) {
             document.body.classList.remove(className);
           }
         });
 
         // Reset body styles
         document.body.style.overflow = '';
         document.body.style.position = '';
         document.body.style.height = '';
         document.body.style.width = '';
         document.body.style.top = '';
         document.body.style.left = '';
         document.documentElement.style.overflow = '';
         document.documentElement.style.position = '';
         document.documentElement.style.height = '';
         document.documentElement.style.width = '';
         
         // Remove any backdrop/overlay elements
         document.querySelectorAll('.modal-backdrop, .overlay-backdrop, .dialog-backdrop').forEach(el => el.remove());
       });
     } catch (error) {
       console.error('Error removing overlays:', error);
     }
   }

  /**
   * Detect if a page is a Single Page Application (SPA)
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<boolean>} True if the page is an SPA
   */
  async detectSPA(page) {
    try {
      return await page.evaluate(() => {
        const spaIndicators = [
          !!document.querySelector('#root'),
          !!document.querySelector('#app'),
          !!document.querySelector('#__next'),
          !!document.querySelector('#gatsby-focus-wrapper'),
          !!document.querySelector('[data-reactroot]'),
          !!document.querySelector('[data-react-app]'),
          !!document.querySelector('[ng-app]'),
          !!document.querySelector('[ng-controller]'),
          !!document.querySelector('[v-app]'),
          !!document.querySelector('[data-v-]'),
          document.querySelectorAll('script').length > 15,
          document.body.innerHTML.length < 20000 && document.querySelectorAll('script').length > 5
        ];
        
        return spaIndicators.some(indicator => indicator);
      });
    } catch (error) {
      console.log(`⚠️ Error detecting SPA: ${error.message}`);
      return false;
    }
  }
}
