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
import { websiteProgress, Phase } from '../../stores/websiteProgressStore.js';

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
  }
};

/**
 * Simplified website progress handler
 * @private
 */
const websiteProgressHandler = (data, fileIdentifier) => {
  // Skip if no data
  if (!data) return;
  
  console.log('[EventHandler] Website progress update:', data);
  
  // Map backend status to frontend phase
  const phaseMap = {
    'initializing': Phase.INITIALIZING,
    'finding_sitemap': Phase.DISCOVERING,
    'parsing_sitemap': Phase.DISCOVERING,
    'crawling_pages': Phase.DISCOVERING,
    'processing_pages': Phase.PROCESSING,
    'processing': Phase.PROCESSING,
    'generating_index': Phase.FINALIZING,
    'completed': Phase.COMPLETED,
    'error': Phase.ERROR
  };
  
  // Create update object
  const update = {};
  
  // Set phase if status is provided
  if (data.status && phaseMap[data.status]) {
    update.phase = phaseMap[data.status];
  }
  
  // Set activity based on status and other data
  if (data.status === 'finding_sitemap') {
    update.currentActivity = `Searching for sitemap at ${data.websiteUrl || fileIdentifier}...`;
  } else if (data.status === 'parsing_sitemap') {
    update.currentActivity = `Found sitemap with ${data.urlCount || 'multiple'} URLs`;
  } else if (data.status === 'processing_pages' || data.status === 'processing') {
    if (data.currentUrl) {
      update.currentActivity = `Processing page: ${data.currentUrl}`;
    }
    update.pagesProcessed = data.processedCount || 0;
    update.pagesFound = data.totalCount || 0;
  } else if (data.status === 'generating_index') {
    update.currentActivity = `Generating index for ${data.processedCount || 0} pages`;
  }
  
  // Update progress
  if (data.progress !== undefined) {
    update.overallProgress = data.progress;
  }
  
  // Update the store
  websiteProgress.updateProgress(update);
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
          console.error('[EventHandler] Received undefined data in progress event handler');
          return;
        }
        
        // Enhanced logging for progress events
        console.log('[EventHandler] Progress event received:', {
          rawData: data,
          fileIdentifier,
          jobId: data.id,
          matchType: data.file === fileIdentifier ? 'file match' : 
                    data.id && this.activeRequests.has(data.id) ? 'job id match' : 'no match',
          hasStatus: !!data.status,
          timestamp: new Date().toISOString(),
          activeRequests: Array.from(this.activeRequests.keys())
        });
        
        if (data.file === fileIdentifier || (data.id && this.activeRequests.has(data.id))) {
          // Prepare batch update for regular conversion status
          const updates = {
            progress: data.progress || 0,
            currentFile: data.file || null
          };
          
          // Apply updates to the regular conversion status
          conversionStatus.batchUpdate(updates);
          
          // Check if this is a website-specific status update
          const websiteStatuses = [
            'initializing',
            'finding_sitemap',
            'parsing_sitemap',
            'crawling_pages',
            'processing_pages',
            'processing',
            'generating_index'
          ];
          
          // If this is a website status update, use our simplified handler
          if (data.status && (websiteStatuses.includes(data.status) || data.status.startsWith('website_'))) {
            // Process with our simplified handler
            websiteProgressHandler(data, fileIdentifier);
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
