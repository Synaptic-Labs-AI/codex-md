/**
 * Page Cleaner Module
 * Handles cleaning up web pages for content extraction
 * 
 * This module provides methods to clean up web pages before content extraction,
 * using Puppeteer's native capabilities to directly manipulate the DOM.
 * The approach is simplified to focus on removing scripts, styles, and other
 * non-content elements without complex pattern matching.
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
        console.log('Starting simplified page cleanup...');
        
        // 1. Remove all script tags
        const scriptCount = document.querySelectorAll('script').length;
        document.querySelectorAll('script').forEach(el => el.remove());
        console.log(`Removed ${scriptCount} script tags`);
        
        // 2. Remove all style tags
        const styleCount = document.querySelectorAll('style').length;
        document.querySelectorAll('style').forEach(el => el.remove());
        console.log(`Removed ${styleCount} style tags`);
        
        // 3. Remove all stylesheet links
        const linkStyleCount = document.querySelectorAll('link[rel="stylesheet"]').length;
        document.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
        console.log(`Removed ${linkStyleCount} stylesheet links`);
        
        // 4. Remove inline styles but keep the elements
        const inlineStyleCount = document.querySelectorAll('[style]').length;
        document.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));
        console.log(`Removed ${inlineStyleCount} inline styles`);
        
        // 5. Remove common non-content elements
        const nonContentSelectors = [
          // Navigation elements
          'nav', 'header', 'footer',
          
          // Sidebars and widgets
          'aside', '.sidebar', '.widget', '.widgets',
          
          // Comments
          '.comments', '#comments', '.comment-section',
          
          // Social sharing
          '.share', '.social', '.social-share',
          
          // Ads
          '.ad', '.ads', '.advertisement', '.banner',
          
          // Popups and overlays
          '.popup', '.modal', '.overlay', '.cookie-notice',
          
          // Chat widgets
          '[id*="chat-widget"]', '.intercom-lightweight-app', '.drift-frame-controller',
          
          // iframes (often ads or embedded content)
          'iframe'
        ];
        
        let nonContentCount = 0;
        nonContentSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            // Don't remove if it's part of main content
            const isContent = el.closest('main, article, [role="main"], [class*="content"], [id*="content"]');
            if (!isContent) {
              el.remove();
              nonContentCount++;
            }
          });
        });
        console.log(`Removed ${nonContentCount} non-content elements`);
        
        // 6. Clean up event handlers
        document.querySelectorAll('*').forEach(el => {
          Array.from(el.attributes).forEach(attr => {
            const name = attr.name;
            // Remove on* event handlers
            if (name.startsWith('on') && 
                !name.startsWith('data-') && 
                !name.startsWith('aria-')) {
              el.removeAttribute(name);
            }
          });
        });
        
        console.log('Page cleanup completed');
      });
    } catch (error) {
      console.error('Error cleaning up page:', error);
      // Continue with extraction even if cleanup fails
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
        console.log('Removing overlays and popups...');
        
        // 1. Try to click common close buttons
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
          'a.close',
          '[role="button"][aria-label*="close" i]'
        ];
        
        let clickCount = 0;
        closeButtonSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(button => {
            try {
              button.click();
              clickCount++;
            } catch (e) {
              // Ignore errors if button can't be clicked
            }
          });
        });
        console.log(`Clicked ${clickCount} close buttons`);
        
        // 2. Remove overlay elements
        const overlaySelectors = [
          // Cookie-related
          '[id*="cookie"]', '[class*="cookie"]',
          '[id*="consent"]', '[class*="consent"]',
          '[id*="gdpr"]', '[class*="gdpr"]',
          
          // Popups and modals
          '[id*="popup"]', '[class*="popup"]',
          '[role="dialog"]', '[aria-modal="true"]',
          '[class*="modal"]', '[id*="modal"]',
          
          // Notifications and banners
          '[id*="banner"]', '[class*="banner"]',
          '[id*="notification"]', '[class*="notification"]',
          
          // Common overlay patterns
          '[class*="overlay"]', '[id*="overlay"]',
          '[class*="lightbox"]', '[id*="lightbox"]'
        ];
        
        let overlayCount = 0;
        overlaySelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(element => {
            // Check if it's likely an overlay
            const style = window.getComputedStyle(element);
            const position = style.position;
            const zIndex = parseInt(style.zIndex, 10);
            
            // Only remove if it looks like an overlay
            if ((position === 'fixed' || position === 'absolute') && 
                (!isNaN(zIndex) && zIndex > 10)) {
              element.remove();
              overlayCount++;
            }
          });
        });
        console.log(`Removed ${overlayCount} overlay elements`);
        
        // 3. Reset body styles that might prevent scrolling
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.height = '';
        document.body.style.width = '';
        document.documentElement.style.overflow = '';
        
        // 4. Remove any backdrop/overlay elements
        document.querySelectorAll('.modal-backdrop, .overlay-backdrop, .dialog-backdrop').forEach(el => el.remove());
        
        console.log('Overlay removal completed');
      });
    } catch (error) {
      console.error('Error removing overlays:', error);
    }
  }
}
