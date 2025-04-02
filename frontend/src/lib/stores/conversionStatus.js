// src/lib/stores/conversionStatus.js

import { writable, derived } from 'svelte/store';
import { files } from './files.js';

// Initial state with more granular progress tracking
const initialState = {
  status: 'ready',         // 'idle' | 'initializing' | 'initializing_workers' | 'selecting_output' | 'preparing' | 'converting' | 'cleaning_up' | 'completed' | 'error' | 'stopped' | 'cancelled'
                          // Website-specific states: 'finding_sitemap' | 'parsing_sitemap' | 'crawling_pages' | 'processing_pages' | 'generating_index'
  progress: 0,            // Overall progress percentage
  currentFile: null,      // Name of the current file being converted
  error: null,            // Error message, if any
  completedCount: 0,      // Number of successfully converted files
  errorCount: 0,          // Number of files that failed to convert
  processedCount: 0,      // Total files processed so far
  totalCount: 0,         // Total number of files to process
  chunkProgress: 0,      // Progress of current file chunking (0-100)
  completionTimestamp: null, // Timestamp when conversion completed
  
  // Website-specific tracking fields
  websiteUrl: null,       // URL of the website being processed
  pathFilter: null,       // Path filter being applied (if any)
  discoveredUrls: 0,      // Number of URLs discovered
  sitemapUrls: 0,         // Number of URLs found in sitemap
  crawledUrls: 0,         // Number of URLs found by crawling
  currentSection: null,   // Current section being processed
  sectionCounts: {},      // Counts of URLs by section
  averagePageTime: 0,     // Average time to process a page (ms)
  estimatedTimeRemaining: null, // Estimated time remaining (ms)
  startTime: null,        // When the website conversion started
};

/**
 * Creates a conversionStatus store with enhanced capabilities
 * @returns {Object} The conversionStatus store instance
 */
function createConversionStore() {
  const { subscribe, set, update } = writable(initialState);
  let completionCallbacks = [];

  return {
    subscribe,
    setStatus: (status) =>
      update((state) => ({ ...state, status })),
    setProgress: (progress) =>
      update((state) => ({ ...state, progress })),
    setCurrentFile: (currentFile) =>
      update((state) => ({ ...state, currentFile })),
    setError: (error) =>
      update((state) => ({ ...state, error, status: error ? 'error' : state.status })),
    reset: () => set(initialState),
    startConversion: (totalFiles) =>
      set({ 
        ...initialState, 
        status: 'converting',
        totalCount: totalFiles
      }),
    completeConversion: () => {
      set({ 
        ...initialState, 
        status: 'completed', 
        progress: 100,
        completionTimestamp: Date.now()
      });
      // Trigger completion callbacks
      completionCallbacks.forEach(callback => callback());
    },
    /**
     * Adds a completion callback
     * @param {Function} callback - The callback function to execute upon completion
     */
    onComplete: (callback) => {
      completionCallbacks.push(callback);
    },
    /**
     * Adds a progress update
     * @param {number} value - The new progress value
     */
    updateProgress: (value) => {
      update(state => ({ ...state, progress: value }));
    },
    /**
     * Increments the completedCount
     */
    incrementCompleted: () => {
      update(state => ({ 
        ...state, 
        completedCount: state.completedCount + 1,
        processedCount: state.processedCount + 1
      }));
    },
    /**
     * Increments the errorCount
     */
    incrementError: () => {
      update(state => ({ 
        ...state, 
        errorCount: state.errorCount + 1,
        processedCount: state.processedCount + 1
      }));
    },
    /**
     * Resets the conversion counts
     */
    resetCounts: () => {
      update(state => ({ 
        ...state, 
        completedCount: 0, 
        errorCount: 0,
        processedCount: 0,
        totalCount: 0,
        chunkProgress: 0
      }));
    },

    // Update chunking progress for the current file
    setChunkProgress: (progress) => {
      update(state => ({ ...state, chunkProgress: Math.min(progress, 100) }));
    },

    // Website-specific tracking methods
    startWebsiteConversion: (url, pathFilter = null) => {
      const startTime = Date.now();
      console.log('[ConversionStatus] Starting website conversion:', {
        url,
        pathFilter,
        startTime,
        timestamp: new Date(startTime).toISOString()
      });
      
      update(state => {
        const newState = {
          ...initialState,
          status: 'finding_sitemap',
          websiteUrl: url,
          pathFilter: pathFilter,
          startTime
        };
        console.log('[ConversionStatus] Initial website state:', newState);
        return newState;
      });
    },

    setWebsiteStatus: (status, details = {}) => {
      console.log('[ConversionStatus] Setting website status:', {
        newStatus: status,
        details,
        timestamp: new Date().toISOString()
      });
      
      // Ensure we're using the correct status names for website conversion
      const validWebsiteStatuses = [
        'initializing', 
        'finding_sitemap', 
        'parsing_sitemap', 
        'crawling_pages', 
        'processing_pages', 
        'generating_index', 
        'completed', 
        'error'
      ];

      if (!validWebsiteStatuses.includes(status)) {
        console.warn('[ConversionStatus] Invalid website status:', {
          invalidStatus: status,
          validStatuses: validWebsiteStatuses
        });
      }
      
      update(state => {
        // Only update status if it's a valid website status or we're in a non-website state
        const newStatus = validWebsiteStatuses.includes(status) ? status : state.status;
        
        return {
          ...state,
          status: newStatus,
          ...details
        };
      });
    },

    updateWebsiteProgress: (data) => {
      console.log('[ConversionStatus] Updating website progress:', {
        ...data,
        timestamp: new Date().toISOString()
      });

      update(state => {
        console.log('[ConversionStatus] Current state before update:', {
          status: state.status,
          processedCount: state.processedCount,
          totalCount: state.totalCount,
          currentSection: state.currentSection
        });

        // Calculate estimated time remaining if we have processed pages
        let estimatedTimeRemaining = null;
        if (data.processedCount > 0 && state.startTime && data.totalCount > 0) {
          const elapsedTime = Date.now() - state.startTime;
          const averagePageTime = elapsedTime / data.processedCount;
          const remainingPages = data.totalCount - data.processedCount;
          estimatedTimeRemaining = averagePageTime * remainingPages;
        }

        // If data contains a status field, ensure it's a valid website status
        const newState = { ...state, ...data };
        
        // If we're updating section counts, merge them properly
        if (data.sectionCounts) {
          newState.sectionCounts = {
            ...state.sectionCounts,
            ...data.sectionCounts
          };
        }
        
        const updatedState = {
          ...newState,
          estimatedTimeRemaining,
          averagePageTime: data.processedCount > 0 && state.startTime 
            ? (Date.now() - state.startTime) / data.processedCount 
            : state.averagePageTime
        };

        console.log('[ConversionStatus] Updated website state:', {
          status: updatedState.status,
          processedCount: updatedState.processedCount,
          totalCount: updatedState.totalCount,
          currentSection: updatedState.currentSection,
          estimatedTimeRemaining: updatedState.estimatedTimeRemaining,
          averagePageTime: updatedState.averagePageTime
        });

        return updatedState;
      });
    },

    updateSectionCounts: (section, count) => {
      console.log('[ConversionStatus] Updating section counts:', {
        section,
        count,
        timestamp: new Date().toISOString()
      });

      update(state => {
        const sectionCounts = { ...state.sectionCounts };
        const previousCount = sectionCounts[section] || 0;
        sectionCounts[section] = previousCount + count;

        console.log('[ConversionStatus] Section count updated:', {
          section,
          previousCount,
          newCount: sectionCounts[section],
          allSections: sectionCounts
        });

        return {
          ...state,
          sectionCounts,
          currentSection: section
        };
      });
    },

    setSitemapStats: (sitemapUrls) => {
      console.log('[ConversionStatus] Setting sitemap stats:', {
        sitemapUrls,
        timestamp: new Date().toISOString()
      });

      update(state => {
        const newState = {
          ...state,
          sitemapUrls,
          discoveredUrls: state.discoveredUrls + sitemapUrls
        };

        console.log('[ConversionStatus] Updated sitemap stats:', {
          previousDiscovered: state.discoveredUrls,
          newDiscovered: newState.discoveredUrls,
          sitemapUrls: newState.sitemapUrls
        });

        return newState;
      });
    },

    setCrawledStats: (crawledUrls) => {
      console.log('[ConversionStatus] Setting crawled stats:', {
        crawledUrls,
        timestamp: new Date().toISOString()
      });

      update(state => {
        const newState = {
          ...state,
          crawledUrls,
          discoveredUrls: state.discoveredUrls + crawledUrls
        };

        console.log('[ConversionStatus] Updated crawled stats:', {
          previousDiscovered: state.discoveredUrls,
          newDiscovered: newState.discoveredUrls,
          crawledUrls: newState.crawledUrls
        });

        return newState;
      });
    }
  };
}

export const conversionStatus = createConversionStore();

// Derived stores for easy access to specific properties
export const conversionProgress = derived(conversionStatus, $status => $status.progress);
export const currentFile = derived(conversionStatus, $status => $status.currentFile);
export const conversionError = derived(conversionStatus, $status => $status.error);
export const completedCount = derived(conversionStatus, $status => $status.completedCount);
export const errorCount = derived(conversionStatus, $status => $status.errorCount);

// Derived store to check if all files are processed
export const isConversionComplete = derived(
  [conversionStatus, files],
  ([$conversionStatus, $files]) => {
    return $files.length > 0 && 
           ($files.filter(f => f.status === 'completed').length + $files.filter(f => f.status === 'error').length) === $files.length;
  }
);
