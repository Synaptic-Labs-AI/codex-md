/**
 * fileTypeUtilsAdapter.js
 * 
 * This adapter provides a CommonJS wrapper around the ES module fileTypeUtils.
 * It allows the Electron code (which uses CommonJS) to import the backend code
 * (which uses ES modules) without compatibility issues.
 * 
 * Related files:
 * - backend/src/utils/fileTypeUtils.js: The original ES module
 * - src/electron/services/ElectronConversionService.js: The consumer of this adapter
 */

// Define fallback functions that will be used until the real ones are loaded
const fallbackRequiresApiKey = (fileType) => {
  console.warn('Using fallback requiresApiKey function');
  return false;
};

/**
 * Gets the category for a specific file type
 * @param {string} type - The file type or category
 * @param {string} fileType - The file extension
 * @returns {string} The category name
 */
const getFileCategory = (type, fileType) => {
  console.warn('Using fallback getFileCategory function');
  
  // Simple fallback logic based on file extension
  const normalizedType = type?.toLowerCase();
  const normalizedFileType = fileType?.toLowerCase();
  
  // Handle presentation files
  if (normalizedFileType === 'pptx' || normalizedFileType === 'ppt') {
    return 'text';
  }
  
  // Audio types
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(normalizedFileType)) {
    return 'multimedia';
  }
  
  // Video types
  if (['mp4', 'webm', 'avi', 'mov'].includes(normalizedFileType)) {
    return 'multimedia';
  }
  
  // Document types - add pptx explicitly
  if (['pdf', 'docx', 'pptx', 'ppt'].includes(normalizedFileType)) {
    return 'text';
  }
  
  // Data files
  if (['csv', 'xlsx', 'xls'].includes(normalizedFileType)) {
    return 'data';
  }
  
  // Web content
  if (['url', 'parenturl'].includes(normalizedType)) {
    return 'web';
  }
  
  // Default to text for unknown types
  return 'text';
};

// Create an object with fallback functions
const exportedFunctions = {
  requiresApiKey: fallbackRequiresApiKey,
  getFileCategory: getFileCategory,
  // For backward compatibility, alias determineCategory to getFileCategory
  determineCategory: getFileCategory
};

// Export the object with fallback functions
module.exports = exportedFunctions;

// Load the real functions asynchronously
(async function loadModule() {
  try {
    // Import the ES module
    const moduleImport = await import('../../../backend/src/utils/fileTypeUtils.js');
    
    // Replace the exports with the real functions if they exist
    if (moduleImport.requiresApiKey) {
      exportedFunctions.requiresApiKey = moduleImport.requiresApiKey;
    }
    
    // If determineCategory exists in the module, use it for both function names
    if (moduleImport.determineCategory) {
      exportedFunctions.determineCategory = moduleImport.determineCategory;
      exportedFunctions.getFileCategory = moduleImport.determineCategory;
    }
    
    console.log('✅ Successfully loaded fileTypeUtils module');
  } catch (error) {
    console.error('❌ Failed to load fileTypeUtils module:', error);
    // Fallbacks are already in place, so no additional action needed
  }
})();
