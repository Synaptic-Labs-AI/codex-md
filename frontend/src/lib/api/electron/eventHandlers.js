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
 * Simplified website progress handler with three-phase system
 * @private
 */
const websiteProgressHandler = (data) => {
  // Skip if no data
  if (!data) return;
  
  console.log('[EventHandler] Website progress update:', data);
  
  // Simplified phase determination
  const determinePhase = (status) => {
    if (['initializing', 'finding_sitemap', 'parsing_sitemap', 'preparing'].includes(status)) {
      return Phase.PREPARE;
    }
    if (['crawling_pages', 'processing_pages', 'processing', 'downloading', 'converting'].includes(status)) {
      return Phase.CONVERTING;
    }
    if (status === 'completed' || status === 'complete') {
      return Phase.COMPLETE;
    }
    return null;
  };

  // Get new phase
  const newPhase = determinePhase(data.status);
  
  // Update phase if we have one
  if (newPhase) {
    // Set appropriate message based on phase
    let currentActivity;
    if (newPhase === Phase.PREPARE) {
      if (data.websiteUrl) {
        currentActivity = data.status === 'finding_sitemap' 
          ? `Analyzing website structure for ${data.websiteUrl}...`
          : data.status === 'parsing_sitemap'
          ? `Found sitemap - preparing to convert ${data.websiteUrl}...`
          : `Preparing to convert ${data.websiteUrl}...`;
      }
    } else if (newPhase === Phase.CONVERTING && data.currentUrl) {
      const progressText = data.totalUrls 
        ? `(page ${data.processedCount || 0} of ${data.totalUrls}${
            data.progress ? ` - ${Math.round(data.progress)}%` : ''
          })`
        : data.progress ? `(${Math.round(data.progress)}%)` : '';
      currentActivity = `Converting ${data.currentUrl} ${progressText}`;
    } else if (newPhase === Phase.COMPLETE) {
      currentActivity = data.processedCount 
        ? `Successfully converted ${data.processedCount} pages! 🎉`
        : `Website conversion complete! 🎉`;
    }

    websiteProgress.setPhase(newPhase, currentActivity);
  }

  // Always update progress data
  websiteProgress.updateProgress({
    currentUrl: data.currentUrl,
    totalUrls: data.totalUrls || data.urlCount,
    processedUrls: data.processedCount,
    percentComplete: data.progress ? Math.min(Math.round(data.progress), 99) : 0
  });

  // Handle errors
  if (data.status === 'error') {
    websiteProgress.setError(data.error || 'Unknown error occurred');
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
    if (!event) return {};
    if (event.data !== undefined) return event.data;
    return {};
  }

  /**
   * Registers event handlers for a conversion job
   */
  registerHandlers(jobId, fileIdentifier, onProgress = null, onItemComplete = null) {
    const handlers = {
      progress: (event, data) => {
        if (!data) {
          console.error('[EventHandler] Received undefined data in progress event handler');
          return;
        }
        
        console.log('[EventHandler] Progress event received:', {
          rawData: data,
          fileIdentifier,
          jobId: data.id,
          matchType: data.file === fileIdentifier ? 'file match' : 
                    data.id && this.activeRequests.has(data.id) ? 'job id match' : 'no match',
          hasStatus: !!data.status,
          timestamp: new Date().toISOString()
        });
        
        if (data.file === fileIdentifier || (data.id && this.activeRequests.has(data.id))) {
          // Handle website-specific updates
          if (data.status && data.status.startsWith('website_') || 
              ['initializing', 'finding_sitemap', 'parsing_sitemap', 'crawling_pages', 
               'processing_pages', 'processing', 'generating_index'].includes(data.status)) {
            websiteProgressHandler(data, fileIdentifier);
          }
          
          if (onProgress) {
            onProgress(data.progress || 0, data);
          }
        }
      },
      
      status: (event, data) => {
        if (!data || !data.id || !this.activeRequests.has(data.id)) return;
        
        const action = statusActions[data.status];
        if (action) {
          action(data);
        } else if (data.status) {
          conversionStatus.setStatus(data.status);
        }
      },
      
      complete: (event, data) => {
        if (!data || !data.id || !this.activeRequests.has(data.id)) return;
        
        websiteProgress.finishConverting(true);
        statusActions.completed(data);
        
        if (onItemComplete) {
          onItemComplete(data);
        }
        
        this.removeHandlers(data.id);
        this.activeRequests.delete(data.id);
      },
      
      error: (event, data) => {
        if (!data || !data.id || !this.activeRequests.has(data.id)) return;
        
        websiteProgress.finishConverting(false, data.error);
        statusActions.error(data);
        
        this.removeHandlers(data.id);
        this.activeRequests.delete(data.id);
      }
    };

    try {
      window.electronAPI.onConversionProgress(handlers.progress);
      window.electronAPI.onConversionStatus(handlers.status);
      window.electronAPI.onConversionComplete(handlers.complete);
      window.electronAPI.onConversionError(handlers.error);

      this.activeRequests.set(jobId, { id: jobId, handlers });
      return handlers;
    } catch (error) {
      if (this.activeRequests.has(jobId)) {
        this.removeHandlers(jobId);
        this.activeRequests.delete(jobId);
      }
      throw error;
    }
  }

  removeHandlers(jobId) {
    if (this.activeRequests.has(jobId)) {
      const { handlers } = this.activeRequests.get(jobId);
      window.electronAPI.offConversionProgress(handlers.progress);
      window.electronAPI.offConversionStatus(handlers.status);
      window.electronAPI.offConversionComplete(handlers.complete);
      window.electronAPI.offConversionError(handlers.error);
    }
  }

  removeAllHandlers() {
    for (const [jobId] of this.activeRequests) {
      this.removeHandlers(jobId);
    }
    this.activeRequests.clear();
  }

  getRequest(jobId) {
    return this.activeRequests.get(jobId);
  }

  isActive(jobId) {
    return this.activeRequests.has(jobId);
  }
  
  getActiveJobs() {
    return Array.from(this.activeRequests.keys());
  }
}

// Create and export singleton instance
const eventHandlerManager = new EventHandlerManager();
export default eventHandlerManager;
