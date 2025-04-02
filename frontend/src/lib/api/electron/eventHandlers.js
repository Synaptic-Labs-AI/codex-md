/**
 * Event Handlers for Electron IPC Communication
 * 
 * Manages event registration and cleanup for IPC communication between
 * renderer and main processes. Also handles status updates and progress tracking.
 * 
 * Related files:
 * - client.js: Core client functionality
 * - converters/*.js: Converter implementations using these handlers
 */

import { conversionStatus } from '../../stores/conversionStatus.js';

/**
 * Maps conversion events to conversionStatus store methods
 * @private
 */
const statusActions = {
  initializing: (state) => {
    conversionStatus.setStatus('initializing');
    conversionStatus.setProgress(0);
  },
  converting: (state) => {
    conversionStatus.setStatus('converting');
    if (state && state.file) {
      conversionStatus.setCurrentFile(state.file);
    }
  },
  completed: (state) => {
    conversionStatus.setStatus('completed');
    conversionStatus.setProgress(100);
    conversionStatus.setCurrentFile(null);
  },
  error: (state) => {
    conversionStatus.setStatus('error');
    conversionStatus.setError((state && state.error) || 'Unknown error occurred');
  },
  cancelled: () => {
    conversionStatus.setStatus('cancelled');
    conversionStatus.setProgress(0);
    conversionStatus.setCurrentFile(null);
  },
  
  // Website-specific status handlers
  finding_sitemap: (state) => {
    conversionStatus.setWebsiteStatus('finding_sitemap', {
      websiteUrl: state?.websiteUrl,
      pathFilter: state?.pathFilter
    });
  },
  parsing_sitemap: (state) => {
    conversionStatus.setWebsiteStatus('parsing_sitemap', {
      sitemapUrls: state?.sitemapUrls || 0
    });
  },
  crawling_pages: (state) => {
    conversionStatus.setWebsiteStatus('crawling_pages', {
      crawledUrls: state?.crawledUrls || 0
    });
  },
  processing_pages: (state) => {
    conversionStatus.setWebsiteStatus('processing_pages', {
      currentFile: state?.currentUrl,
      processedCount: state?.processedCount || 0,
      totalCount: state?.totalCount || 0
    });
  },
  generating_index: (state) => {
    conversionStatus.setWebsiteStatus('generating_index', {
      processedCount: state?.processedCount || 0,
      totalCount: state?.totalCount || 0
    });
  }
};

/**
 * Manages active conversion requests
 */
class EventHandlerManager {
  constructor() {
    this.activeRequests = new Map();
  }

  /**
   * Safely extracts data from an event
   * @private
   * @param {Event} event The event object
   * @returns {Object} The extracted data or an empty object
   */
  _safelyExtractData(event) {
    // Check if event exists and has data property
    if (!event) return {};
    
    // Handle different event data structures
    if (event.data !== undefined) return event.data;
    
    // For direct data passing (second argument in handlers)
    return {};
  }

  /**
   * Registers event handlers for a conversion job
   * @param {string} jobId Unique identifier for the conversion job
   * @param {string} fileIdentifier Path or identifier of the file/resource being converted
   * @param {Function} onProgress Callback for progress updates
   * @param {Function} [onItemComplete] Optional callback for batch operations
   * @returns {Object} Object containing the registered event handlers
   */
  registerHandlers(jobId, fileIdentifier, onProgress = null, onItemComplete = null) {
    const handlers = {
      progress: (event, data) => {
        // Ensure data is defined before accessing properties
        if (!data) {
          console.error('Received undefined data in progress event handler');
          return;
        }
        
        if (data.file === fileIdentifier || (data.id && this.activeRequests.has(data.id))) {
          // Update progress
          conversionStatus.setProgress(data.progress || 0);
          
          // Handle standard file progress
          if (data.file) {
            conversionStatus.setCurrentFile(data.file);
          }
          
          // Handle direct website-specific status updates
          if (data.status) {
            // Check if this is a website-specific status
            const websiteStatuses = [
              'finding_sitemap',
              'parsing_sitemap',
              'crawling_pages',
              'processing_pages',
              'generating_index'
            ];
            
            if (websiteStatuses.includes(data.status)) {
              console.log(`Received direct website status update: ${data.status}`, data);
              // Directly update the website status
              conversionStatus.setWebsiteStatus(data.status, data);
            }
            // Handle legacy website_* prefixed status updates for backward compatibility
            else if (data.status.startsWith('website_')) {
              // Extract the actual status by removing the 'website_' prefix
              const websiteStatus = data.status.substring(8);
              console.log(`Received legacy website progress update: ${websiteStatus}`, data);
              
              // Map website-specific progress status to main status
              const statusMap = {
                'progress': 'processing_pages',
                'section': 'processing_pages',
                'sitemap': 'parsing_sitemap',
                'crawling': 'crawling_pages'
              };
              
              // Update the main status if we have a mapping
              if (statusMap[websiteStatus]) {
                console.log(`Updating main status to: ${statusMap[websiteStatus]}`);
                conversionStatus.setWebsiteStatus(statusMap[websiteStatus], data);
              }
              
              // Update website-specific progress data
              if (websiteStatus === 'progress') {
                conversionStatus.updateWebsiteProgress({
                  processedCount: data.processedCount || 0,
                  totalCount: data.totalCount || 0,
                  progress: data.progress || 0,
                  currentFile: data.currentUrl
                });
              } else if (websiteStatus === 'section') {
                conversionStatus.updateSectionCounts(
                  data.section || 'unknown',
                  data.count || 1
                );
              } else if (websiteStatus === 'sitemap') {
                conversionStatus.setSitemapStats(data.urlCount || 0);
              } else if (websiteStatus === 'crawling') {
                conversionStatus.setCrawledStats(data.urlCount || 0);
              }
            }
          }
          
          if (onProgress) {
            onProgress(data.progress || 0, data);
          }
        }
      },
      
      status: (event, data) => {
        // Ensure data is defined before accessing properties
        if (!data) {
          console.error('Received undefined data in status event handler');
          return;
        }
        
        if (data.id && this.activeRequests.has(data.id)) {
          const action = data.status && statusActions[data.status];
          if (action) {
            action(data);
          } else if (data.status) {
            conversionStatus.setStatus(data.status);
          }
        }
      },
      
      complete: (event, data) => {
        // Ensure data is defined before accessing properties
        if (!data) {
          console.error('Received undefined data in complete event handler');
          return;
        }
        
        if (data.id && this.activeRequests.has(data.id)) {
          statusActions.completed(data);
          
          if (onItemComplete) {
            onItemComplete(data);
          }
          
          this.removeHandlers(data.id);
          this.activeRequests.delete(data.id);
        }
      },
      
      error: (event, data) => {
        // Ensure data is defined before accessing properties
        if (!data) {
          console.error('Received undefined data in error event handler');
          return;
        }
        
        if (data.id && this.activeRequests.has(data.id)) {
          statusActions.error(data);
          
          this.removeHandlers(data.id);
          this.activeRequests.delete(data.id);
        }
      }
    };

    try {
      // Register event handlers
      window.electronAPI.onConversionProgress(handlers.progress);
      window.electronAPI.onConversionStatus(handlers.status);
      window.electronAPI.onConversionComplete(handlers.complete);
      window.electronAPI.onConversionError(handlers.error);

      // Store handlers for cleanup
      this.activeRequests.set(jobId, {
        id: jobId,
        handlers
      });

      return handlers;
    } catch (error) {
      // If registration fails, clean up any handlers that were registered
      if (this.activeRequests.has(jobId)) {
        this.removeHandlers(jobId);
        this.activeRequests.delete(jobId);
      }
      throw error;
    }
  }

  /**
   * Removes event handlers for a conversion job
   * @param {string} jobId Unique identifier for the conversion job
   */
  removeHandlers(jobId) {
    if (this.activeRequests.has(jobId)) {
      const { handlers } = this.activeRequests.get(jobId);
      
      // Remove event listeners
      window.electronAPI.offConversionProgress(handlers.progress);
      window.electronAPI.offConversionStatus(handlers.status);
      window.electronAPI.offConversionComplete(handlers.complete);
      window.electronAPI.offConversionError(handlers.error);
    }
  }

  /**
   * Removes all active event handlers
   */
  removeAllHandlers() {
    for (const [jobId] of this.activeRequests) {
      this.removeHandlers(jobId);
    }
    this.activeRequests.clear();
  }

  /**
   * Gets an active request by ID
   * @param {string} jobId Request ID
   * @returns {Object|undefined} The request object if found
   */
  getRequest(jobId) {
    return this.activeRequests.get(jobId);
  }

  /**
   * Checks if a request is active
   * @param {string} jobId Request ID
   * @returns {boolean} Whether the request is active
   */
  isActive(jobId) {
    return this.activeRequests.has(jobId);
  }
  
  /**
   * Gets all active job IDs
   * @returns {Array<string>} Array of active job IDs
   */
  getActiveJobs() {
    return Array.from(this.activeRequests.keys());
  }
}

// Create and export singleton instance
const eventHandlerManager = new EventHandlerManager();
export default eventHandlerManager;
