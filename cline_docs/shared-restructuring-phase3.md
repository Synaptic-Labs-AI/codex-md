# Phase 3: Electron Implementation

This document provides detailed step-by-step instructions for implementing the electron utilities as part of the shared package restructuring.

## 1. Create Directory Structure

First, create the necessary directory structure for the electron utilities:

```bash
mkdir -p src/electron/utils/files
mkdir -p src/electron/utils/conversion
mkdir -p src/electron/utils/paths
```

## 2. Implement File Type Utilities

### Step 2.1: Create types.js

Create `src/electron/utils/files/types.js` with the following content:

```javascript
/**
 * File type detection and categorization utilities
 * Provides centralized file type handling for the electron process
 */

// File Categories - Group similar file types
const FILE_CATEGORIES = {
  documents: ['pdf', 'docx', 'pptx', 'rtf', 'txt', 'md'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  data: ['csv', 'xlsx', 'xls', 'json', 'yaml'],
  web: ['url', 'parenturl']
};

// File handling types - How the file should be processed
const HANDLING_TYPES = {
  BINARY: 'binary',    // Read as buffer
  TEXT: 'text',       // Read as UTF-8
  URL: 'url'         // Process as URL
};

// Converter configuration - Maps file types to their handling requirements
const CONVERTER_CONFIG = {
  // Documents
  docx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'text',
    requiresOcr: false
  },
  pptx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'text',
    requiresOcr: false
  },
  pdf: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'pdf',
    requiresOcr: true
  },
  
  // Data files
  xlsx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'data',
    requiresOcr: false
  },
  csv: {
    handling: HANDLING_TYPES.TEXT,
    converter: 'data',
    requiresOcr: false
  },
  
  // Media files
  mp3: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'audio',
    requiresOcr: false
  },
  wav: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'audio',
    requiresOcr: false
  },
  mp4: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'video',
    requiresOcr: false
  }
};

// List of types that require an API key
const API_REQUIRED_TYPES = [
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',  // Audio
  'mp4', 'webm', 'avi', 'mov', 'mpeg'   // Video
];

/**
 * Get comprehensive file handling information
 * @param {string|Object} file - File to analyze
 * @returns {Object} Complete file handling details including type, category, and handling requirements
 */
function getFileHandlingInfo(file) {
  // Get basic file info
  const fileName = typeof file === 'string' ? file : 
                 file.name || file.originalFileName || 'unknown';
  const fileType = fileName.split('.').pop().toLowerCase();
  
  // Handle web content types
  if (typeof file === 'object' && file.type && ['url', 'parenturl'].includes(file.type)) {
    return {
      fileName,
      fileType: file.type,
      category: 'web',
      handling: HANDLING_TYPES.URL,
      converter: file.type, // Preserve original type (url/parenturl)
      requiresOcr: false,
      isWeb: true,
      isBinary: false
    };
  }
  
  // Get category
  let category = 'unknown';
  for (const [cat, extensions] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(fileType)) {
      category = cat;
      break;
    }
  }
  
  // Get converter config
  const config = CONVERTER_CONFIG[fileType] || {
    handling: HANDLING_TYPES.TEXT,
    converter: 'text',
    requiresOcr: false
  };
  
  return {
    fileName,
    fileType,
    category,
    ...config,
    isWeb: category === 'web',
    isBinary: config.handling === HANDLING_TYPES.BINARY,
    requiresApiKey: API_REQUIRED_TYPES.includes(fileType)
  };
}

/**
 * Convert a File object to buffer or text based on handling type
 * @param {Object} file - File to process
 * @returns {Promise<Buffer|string>} Processed content
 */
async function getFileContent(file) {
  const info = getFileHandlingInfo(file);
  
  if (info.isBinary) {
    return file.buffer || Buffer.from(file.arrayBuffer || []);
  }
  
  return file.text || '';
}

/**
 * Get the category of a file
 * @param {string|Object} file - File to analyze
 * @returns {string} File category
 */
function getFileType(file) {
  const info = getFileHandlingInfo(file);
  return info.category;
}

/**
 * Check if a file requires an API key
 * @param {string|Object} file - File to analyze
 * @returns {boolean} Whether the file requires an API key
 */
function requiresApiKey(file) {
  const info = getFileHandlingInfo(file);
  return info.requiresApiKey;
}

// CommonJS exports
module.exports = {
  FILE_CATEGORIES,
  HANDLING_TYPES,
  CONVERTER_CONFIG,
  API_REQUIRED_TYPES,
  getFileHandlingInfo,
  getFileContent,
  getFileType,
  requiresApiKey
};
```

### Step 2.2: Create files/index.js

Create `src/electron/utils/files/index.js` with the following content:

```javascript
/**
 * Files utilities barrel file for electron
 * Exports all file-related utilities in an organized way
 */

const types = require('./types');

// Group functions by category
const fileTypes = {
  getFileHandlingInfo: types.getFileHandlingInfo,
  requiresApiKey: types.requiresApiKey,
  getFileType: types.getFileType,
  getFileContent: types.getFileContent,
  FILE_CATEGORIES: types.FILE_CATEGORIES,
  API_REQUIRED_TYPES: types.API_REQUIRED_TYPES,
  HANDLING_TYPES: types.HANDLING_TYPES,
  CONVERTER_CONFIG: types.CONVERTER_CONFIG
};

// CommonJS exports
module.exports = {
  // Types
  FILE_CATEGORIES: types.FILE_CATEGORIES,
  API_REQUIRED_TYPES: types.API_REQUIRED_TYPES,
  HANDLING_TYPES: types.HANDLING_TYPES,
  CONVERTER_CONFIG: types.CONVERTER_CONFIG,
  getFileHandlingInfo: types.getFileHandlingInfo,
  requiresApiKey: types.requiresApiKey,
  getFileType: types.getFileType,
  getFileContent: types.getFileContent,
  
  // Grouped exports
  fileTypes
};
```

## 3. Create Main Utils Index

Create `src/electron/utils/index.js` with the following content:

```javascript
/**
 * Main utilities barrel file for electron
 * Exports all utilities in an organized way
 */

const files = require('./files');

// Utility groups
const utils = {
  files: {
    types: files.fileTypes
  }
};

// CommonJS exports
module.exports = {
  // Re-export all modules
  files,
  
  // Utility groups
  utils,
  
  // Common aliases
  getFileHandlingInfo: files.getFileHandlingInfo,
  getFileType: files.getFileType,
  requiresApiKey: files.requiresApiKey
};
```

## 4. Implement Conversion Utilities (Optional)

If needed, implement conversion utilities in the `src/electron/utils/conversion/` directory:

### Step 4.1: Create conversion/index.js

Create `src/electron/utils/conversion/index.js` with the following content:

```javascript
/**
 * Conversion utilities for electron
 * Provides utilities for converting files to markdown
 */

// Import any dependencies
const path = require('path');
const fs = require('fs');

// Define conversion utilities
function getConverterByExtension(extension) {
  // Implementation
  return null;
}

function getConverterByMimeType(mimeType) {
  // Implementation
  return null;
}

// CommonJS exports
module.exports = {
  getConverterByExtension,
  getConverterByMimeType
};
```

## 5. Implement Path Utilities (Optional)

If needed, implement path utilities in the `src/electron/utils/paths/` directory:

### Step 5.1: Create paths/index.js

Create `src/electron/utils/paths/index.js` with the following content:

```javascript
/**
 * Path utilities for electron
 * Provides utilities for working with file paths
 */

// Import any dependencies
const path = require('path');
const fs = require('fs');

// Define path utilities
function normalizePath(filePath) {
  // Implementation
  return path.normalize(filePath);
}

function joinPaths(...paths) {
  // Implementation
  return path.join(...paths);
}

// CommonJS exports
module.exports = {
  normalizePath,
  joinPaths
};
```

## Next Steps

Proceed to [Phase 4: Backend Implementation](./shared-restructuring-phase4.md) to implement the backend utilities (if needed).