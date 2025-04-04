/**
 * Conversion Module Index
 * 
 * Provides a unified export interface for the conversion system.
 * This allows importing from a single location rather than individual files.
 */

// Export main conversion manager and its methods
export { default as conversionManager } from './manager/conversionManager.js';
export {
    startConversion,
    cancelConversion,
    clearFiles,
    openFile,
    showInFolder
} from './manager/conversionManager.js';

// Export store manager for direct store access
export { storeManager } from './manager/storeManager.js';

// Export individual handlers for advanced usage
export { conversionHandler } from './handlers/conversionHandler.js';
export { batchHandler } from './handlers/batchHandler.js';
export { downloadHandler } from './handlers/downloadHandler.js';
export { tempFileManager } from './handlers/tempFileManager.js';

// Export constants
export * from './constants';
