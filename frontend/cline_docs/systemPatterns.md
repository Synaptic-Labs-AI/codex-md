# System Patterns

## Architecture Overview
The application follows a modern Single Page Application (SPA) architecture built with SvelteKit.

### Core Components

1. File Management Layer
- `FileUploader.svelte`: Handles file input and validation
- `FileList.svelte`: Manages the list of files to be converted
- Supports drag-and-drop and URL-based inputs

2. Conversion Management Layer
- `conversionManager.js`: Orchestrates the conversion process
- Handles batch processing and progress tracking
- Manages file preparation and API communication

3. State Management
- Svelte stores for reactive state management:
  - `files.js`: File queue and status
  - `apiKey.js`: API authentication
  - `conversionStatus.js`: Conversion progress
  - `uploadStore.js`: Upload feedback

4. API Integration
- REST API client architecture
- Endpoint-specific request handling
- Error management with custom error types

## Key Technical Patterns

### 1. File Processing Pipeline
```
Upload → Validation → Preparation → Conversion → Download
```
- File validation before processing
- Base64 encoding for file transfer
- Structured error handling

### 2. State Management Pattern
- Centralized stores for application state
- Reactive updates using Svelte stores
- Persistent state for API keys

### 3. Error Handling Strategy
- Custom error types for different scenarios
- User-friendly error messages
- Graceful fallbacks

### 4. Component Architecture
- Modular component design
- Common components in shared directory
- Consistent styling patterns

### 5. File Type Handling
- Extension-based file type detection
- Category-based processing rules
- Flexible converter mapping

## Data Flow
1. User Input → File/URL validation
2. Valid files → Preparation for conversion
3. API requests with progress tracking
4. Response handling and ZIP creation
5. Download delivery to user

## Security Patterns
1. API Key Management
   - Secure storage
   - Key validation
   - Protected routes

2. File Validation
   - Type checking
   - Size limits
   - Content validation

## Technical Decisions
1. SvelteKit Framework
   - Fast performance
   - Small bundle size
   - Built-in routing

2. Vite Build Tool
   - Quick development builds
   - Efficient HMR
   - Modern tooling

3. Node.js Backend
   - Express server
   - Production-ready setup
   - Easy deployment
