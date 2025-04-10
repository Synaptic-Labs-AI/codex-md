# Phase 4: Backend Implementation

This document provides detailed step-by-step instructions for implementing the backend utilities as part of the shared package restructuring.

## 1. Analyze Backend Requirements

First, determine which shared utilities are used by the backend:

1. Review backend code to identify imports from the shared package
2. Identify critical utilities that need to be copied to the backend

## 2. Create Directory Structure

Create the necessary directory structure for the backend utilities:

```bash
mkdir -p backend/src/utils/files
```

## 3. Implement File Type Utilities

If the backend requires file type utilities, implement them:

### Step 3.1: Create types.js

Create `backend/src/utils/files/types.js` with the following content:

```javascript
/**
 * File type detection and categorization utilities
 * Provides centralized file type handling for the backend
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
  getFileType,
  requiresApiKey
};
```

### Step 3.2: Create files/index.js

Create `backend/src/utils/files/index.js` with the following content:

```javascript
/**
 * Files utilities barrel file for backend
 * Exports all file-related utilities in an organized way
 */

const types = require('./types');

// Group functions by category
const fileTypes = {
  getFileHandlingInfo: types.getFileHandlingInfo,
  requiresApiKey: types.requiresApiKey,
  getFileType: types.getFileType,
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
  
  // Grouped exports
  fileTypes
};
```

## 4. Create Main Utils Index

Create `backend/src/utils/index.js` with the following content:

```javascript
/**
 * Main utilities barrel file for backend
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

## 5. Implement Additional Utilities (Optional)

If the backend requires additional utilities from the shared package, implement them in the appropriate directories:

- Create `backend/src/utils/markdown/` directory for markdown utilities
- Create `backend/src/utils/conversion/` directory for conversion utilities

## 6. Update Backend Package.json

Update `backend/package.json` to remove the dependency on the shared package:

```json
{
  "dependencies": {
    // Remove @codex-md/shared dependency
  }
}
```

## Next Steps

Proceed to [Phase 5: Update Import Paths](./shared-restructuring-phase5.md) to update import paths throughout the codebase.