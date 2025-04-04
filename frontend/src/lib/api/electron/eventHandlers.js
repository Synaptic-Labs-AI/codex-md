/**
 * Event Handlers for Electron IPC Communication
 * 
 * Simplified event registration and cleanup for IPC communication between
 * renderer and main processes. Focuses only on essential status updates.
 * 
 * Related files:
 * - client.js: Core client functionality
 * - converters/*.js: Converter implementations using these handlers
 */

import { unifiedConversion, ConversionState } from '../../stores/unifiedConversion.js';

/**
 * Maps conversion events to unifiedConversion store methods
 * @private
 */
const statusActions = {
  initializing: () => {
    unifiedConversion.setStatus(ConversionState.STATUS.INITIALIZING);
  },
  converting: (state) => {
    unifiedConversion.setStatus(ConversionState.STATUS.CONVERTING);
    if (state && state.file) {
      unifiedConversion.setCurrentFile(state.file);
    }
  },
  completed: () => {
    unifiedConversion.completeConversion();
  },
  error: (state) => {
    unifiedConversion.setError((state && state.error) || 'Unknown error occurred');
  },
  cancelled: () => {
    unifiedConversion.setStatus(ConversionState.STATUS.CANCELLED);
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
   * Registers event handlers for a conversion job
   */
  registerHandlers(jobId, fileIdentifier, onProgress = null, onItemComplete = null) {
    const handlers = {
      progress: (event, data) => {
        if (!data) return;
        
        console.log('[EventHandler] Progress event received:', {
          progress: data.progress,
          status: data.status,
          timestamp: new Date().toISOString()
        });
        
        // Update progress in store
        if (data.progress !== undefined) {
          unifiedConversion.setProgress(data.progress);
        }
        
        // Update status if provided
        if (data.status) {
          unifiedConversion.batchUpdate({ status: data.status });
        }
        
        // Call progress callback if provided
        if (onProgress) {
          onProgress(data.progress || 0, data);
        }
      },
      
      status: (event, data) => {
        if (!data) return;
        
        const action = statusActions[data.status];
        if (action) {
          action(data);
        } else if (data.status) {
          unifiedConversion.setStatus(data.status);
        }
      },
      
      complete: (event, data) => {
        console.log('[EventHandler] Completion event received');
        
        // Mark conversion as complete
        unifiedConversion.completeConversion();
        
        if (onItemComplete) {
          onItemComplete(data);
        }
        
        // Clean up
        this.removeHandlers(jobId);
        this.activeRequests.delete(jobId);
      },
      
      error: (event, data) => {
        console.error('[EventHandler] Error event received:', data?.error);
        
        // Set error state
        unifiedConversion.setError(data?.error || 'Unknown error occurred');
        
        // Clean up
        this.removeHandlers(jobId);
        this.activeRequests.delete(jobId);
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
