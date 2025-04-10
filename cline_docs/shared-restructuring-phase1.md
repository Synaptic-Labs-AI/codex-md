# Phase 1: Analysis and Preparation

This document outlines the analysis and preparation steps for restructuring the shared package utilities.

## 1. Identify Critical Utilities

### File Type Utilities
- **Location**: `shared/src/utils/files/types.js`
- **Critical Functions**:
  - `getFileHandlingInfo`: Used for determining file handling requirements
  - `getFileType`: Legacy function for determining file category
  - `requiresApiKey`: Checks if a file type requires an API key
  - `getFileContent`: Converts a File object to buffer or text
- **Constants**:
  - `FILE_CATEGORIES`: Groups similar file types
  - `HANDLING_TYPES`: Defines how files should be processed
  - `CONVERTER_CONFIG`: Maps file types to handling requirements
  - `API_REQUIRED_TYPES`: Lists types requiring API keys

### Markdown Utilities
- **Location**: `shared/src/utils/markdown/`
- **Critical Functions**:
  - `generateMarkdown`: Generates markdown from various inputs
  - `formatMetadata`: Formats metadata for markdown documents

### Web Utilities
- **Location**: `shared/src/utils/web/`
- **Critical Functions**:
  - `extractMetadata`: Extracts metadata from web content

### Conversion Utilities
- **Location**: `shared/src/utils/conversion/`
- **Critical Functions**:
  - `convertToMarkdown`: Converts various formats to markdown
  - `getConverterByExtension`: Gets converter based on file extension
  - `getConverterByMimeType`: Gets converter based on MIME type

### Path Utilities
- **Location**: `shared/src/utils/paths/`
- **Critical Functions**:
  - Path normalization and manipulation functions

## 2. Identify Usage Patterns

### Frontend Usage
- **Components Using File Type Utilities**:
  - `frontend/src/lib/components/FileUploader.svelte`
  - `frontend/src/lib/stores/files.js`
  - `frontend/src/lib/api/electron/client.js`
  
- **Import Patterns**:
  ```javascript
  import { getFileHandlingInfo } from '@codex-md/shared';
  // or
  import { getFileHandlingInfo } from '@shared/utils/files/types';
  ```

### Electron Usage
- **Components Using File Type Utilities**:
  - `src/electron/ipc/handlers/conversion/index.js`
  - `src/electron/converters/UnifiedConverterFactory.js`
  - `src/electron/services/ElectronConversionService.js`
  
- **Import Patterns**:
  ```javascript
  const { getFileHandlingInfo } = require('@codex-md/shared');
  // or
  const { getFileHandlingInfo } = require('../../../shared/src/utils/files/types');
  ```

### Backend Usage (if applicable)
- Identify any backend components using shared utilities

## 3. Create Directory Structure

### Frontend Directory Structure
Create the following directory structure:
```
frontend/src/lib/utils/
├── files/
│   ├── index.js
│   ├── types.js
│   ├── validation.js
│   └── sanitization.js
├── markdown/
│   ├── index.js
│   └── ... (other markdown utilities)
├── web/
│   ├── index.js
│   └── ... (other web utilities)
└── index.js
```

### Electron Directory Structure
Create the following directory structure:
```
src/electron/utils/
├── files/
│   ├── index.js
│   ├── types.js
│   ├── validation.js
│   └── sanitization.js
├── conversion/
│   ├── index.js
│   └── ... (other conversion utilities)
├── paths/
│   ├── index.js
│   └── ... (other path utilities)
└── index.js
```

### Backend Directory Structure (if needed)
Create the following directory structure:
```
backend/src/utils/
├── files/
│   ├── index.js
│   └── types.js
└── index.js
```

## 4. File Creation Plan

For each component (frontend, electron, backend):

1. Create directory structure
2. Copy relevant utility files
3. Adapt export patterns for the appropriate module system
4. Create index files for easy importing
5. Update import paths in existing files

## Next Steps

Proceed to [Phase 2: Frontend Implementation](./shared-restructuring-phase2.md) to begin implementing the frontend utilities.