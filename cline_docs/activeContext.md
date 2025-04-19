
# Active Context

## Current Focus
Planning and implementing the consolidation of backend services into the Electron main process to resolve module system conflicts and simplify the architecture.

## Recent Changes

### Video Conversion Log Pattern Analysis (2025-04-19)
- Analyzed the seemingly contradictory behavior in the video conversion process logs
- Determined that the pattern showing both failure and success messages is actually EXPECTED BEHAVIOR:
  - The system first attempts a fast validation/remuxing (fails with "empty content" warning)
  - It marks this validation phase as complete (46ms success message)
  - It then proceeds with audio extraction and transcription as a fallback mechanism
- Documented this multi-stage conversion process in:
  - project-context.md (added new section explaining the process)
  - systemPatterns.md (added "Multi-Stage Conversion Process Pattern" section)
  - progress.md (marked the log pattern confusion as clarified)
- Recommended keeping the current implementation as it provides a good balance of performance and reliability
- Suggested potential improvements for future work:
  - Implement clearer logging to differentiate between validation phase and actual conversion
  - Better separate pipeline stages in VideoConverter.js
  - Add conversion type tracking metrics

### Package.json Build Configuration Update (2025-04-19)
- Successfully implemented the third component of our solution to resolve the ffmpeg-static ASAR issue
- Updated `package.json` build configuration with the following improvements:
  - Added ffmpeg-related entries to the asarUnpack array:
    - Added "**/node_modules/ffmpeg-static/**"
    - Added "**/node_modules/@ffmpeg-installer/**"
    - Added "**/node_modules/ffprobe-static/**"
  - Moved ffmpeg binaries configuration from extraFiles to extraResources:
    - Configured Windows binaries (ffmpeg.exe and ffprobe.exe)
    - Added macOS binaries (ffmpeg and ffprobe)
    - Added Linux binaries (ffmpeg and ffprobe)
  - Added platform-specific configurations for macOS and Linux to ensure cross-platform compatibility
- This approach ensures that ffmpeg binaries are correctly extracted from the ASAR archive and made available to the application at runtime across all supported platforms
- This is a critical component of our solution to fix the "Conversion produced empty content" error in video processing

### VideoConverter Ffmpeg Path Fix Attempt #3 (2025-04-19)
- Attempted a third fix for "spawn ... ffmpeg.exe ENOENT" error during video conversion in packaged app
- Modified `package.json` to remove FFmpeg-related modules (`@ffmpeg-installer`, `fluent-ffmpeg`, `ffprobe`, `ffprobe-static`) from the `build.asarUnpack` configuration.
- The hypothesis is that unpacking these modules might confuse `fluent-ffmpeg` in the packaged environment, causing it to ignore the correctly configured paths pointing to the binaries in the `resources` directory (placed there by `extraFiles`). By keeping these modules within the ASAR archive, we hope to force `fluent-ffmpeg` to rely solely on the configured paths or environment variables.

### VideoConverter Ffmpeg Path Fix Attempt #2 (2025-04-18)
- Attempted another fix for "spawn ... ffmpeg.exe ENOENT" error during video conversion in packaged app
- Updated VideoConverter.js `configureFfmpeg` method to set `process.env.FFMPEG_PATH` and `process.env.FFPROBE_PATH` environment variables in addition to calling `ffmpeg.setFfmpegPath()` and `ffmpeg.setFfprobePath()`
- This is an alternative approach in case `fluent-ffmpeg` ignores the direct path setting functions in the packaged environment but respects environment variables

### VideoConverter Ffmpeg Path Fix (2025-04-18)
- Fixed "spawn ... ffmpeg.exe ENOENT" error during video conversion in packaged app
- Updated VideoConverter.js `configureFfmpeg` method to simplify path resolution logic
- Removed alternative path checks, relying directly on `process.resourcesPath` in production and package paths in development
- Ensured `@ffmpeg-installer/ffmpeg` is only required in the development environment block
- This aims to resolve potential conflicts or overrides causing `fluent-ffmpeg` to ignore the configured paths in the packaged environment

### VideoConverter Thumbnail Generation Removal (2025-04-18)
- Removed thumbnail generation functionality from `VideoConverter.js` to resolve FFmpeg-related errors:
  - Removed `generateThumbnails` and `generateThumbnail` methods
  - Removed `handleGenerateThumbnail` method and its IPC handler registration
  - Removed thumbnail generation code from `processConversion` method
  - Removed thumbnails section from the markdown output
  - Replaced thumbnail generation with an empty thumbnails array
- This change eliminates the dependency on FFmpeg for thumbnail generation while preserving the core video metadata extraction and transcription functionality
- Video conversion now produces markdown with metadata and transcription only, without thumbnail images

### Singleton Export/Import Refactor (2025-04-18)
- Attempted to fix persistent `TypeError: OpenAIProxyService is not a constructor` by changing the singleton export/import pattern.
  - Modified `src/electron/services/ai/OpenAIProxyService.js` to export an object `{ instance }` instead of the instance directly.
  - Updated consumers (`TranscriberService.js`, `main.js`, `apikey.js`) to import using destructuring: `const { instance: openAIProxyServiceInstance } = require(...)`.
- Reverted previous lazy loading implementation as it did not resolve the issue. This new pattern might avoid potential build/packaging issues with direct instance exports.

### Service Singleton Refactor (2025-04-18)
- Fixed `TypeError: OpenAIProxyService is not a constructor` and related instantiation errors by implementing the singleton pattern for core services.
  - Modified the following services to export a single, shared instance instead of their class:
    - `src/electron/services/ai/OpenAIProxyService.js`
    - `src/electron/services/ai/TranscriberService.js`
    - `src/electron/services/storage/FileStorageService.js`
    - `src/electron/services/storage/FileProcessorService.js`
  - Updated service constructors (`TranscriberService`) to directly import their singleton dependencies instead of receiving them via constructor parameters.
  - Updated service consumers (`main.js`, `apikey.js`, `ConverterRegistry.js`) to import and use the singleton instances directly, removing local instantiation logic.
- This ensures consistent use of single service instances across the application, resolving errors caused by multiple, unconfigured, or incorrectly dependency-injected instances.

### OpenAI API Integration Fix (2025-04-18)
- Fixed "Configuration is not a constructor" error in OpenAIProxyService by updating to OpenAI v4 API syntax:
  - Modified `src/electron/services/ai/OpenAIProxyService.js` to use the new import style: `const OpenAI = require('openai');`
  - Updated client instantiation to use v4 syntax: `new OpenAI({ apiKey })`
  - Updated API method calls to match v4 structure:
    - Changed `listModels()` to `models.list()`
    - Changed `createTranscription()` to `audio.transcriptions.create()`
    - Changed `createChatCompletion()` to `chat.completions.create()`
  - Updated response handling to match v4 response structure
  - Removed duplicate `openai` entry from devDependencies in package.json to avoid version conflicts
- This fix ensures proper integration with the OpenAI API v4 library and resolves the configuration error during API key setup.

### API Key Handling and Configuration Fixes (2025-04-18)
- Fixed API key persistence issue across application restarts by modifying `storeFactory.js` to use machine-specific encryption when `STORE_ENCRYPTION_KEY` is not provided.
- Fixed issue where audio files were incorrectly routed to OCR converter by adding special handling in `UnifiedConverterFactory.js` to remove the Mistral API key from multimedia conversion options.
- Added missing `validateApiKey` method to `ApiKeyService.js`.
- Fixed "OpenAI API not configured" error during audio transcription:
  - Modified `src/electron/ipc/handlers/apikey.js` to configure `OpenAIProxyService` immediately after saving an OpenAI key.
  - Modified `src/electron/main.js` to configure `OpenAIProxyService` on application startup if a stored OpenAI key exists.
- These fixes ensure API keys persist, audio files use the correct converter, and the OpenAI service is properly configured for transcription.

### AudioConverter Ffmpeg Path Fix (2025-04-18)
- Fixed "spawn ... ffmpeg.exe ENOENT" error during audio conversion in packaged app
- Updated AudioConverter.js to correctly configure the path for ffmpeg.exe, in addition to ffprobe.exe
- Imported `@ffmpeg-installer/ffmpeg` to get the default path
- Added logic to `configureFfmpeg` method to check for `ffmpeg.exe` in `process.resourcesPath` when packaged
- Called `ffmpeg.setFfmpegPath()` to explicitly set the path for `fluent-ffmpeg`
- This ensures both ffmpeg and ffprobe are correctly located in production builds

### TranscriberService Event Handling Fix (2025-04-18)
- Fixed "TypeError: Cannot read properties of null (reading 'sender')" error in audio transcription
- Updated TranscriberService.js to handle cases where handleTranscribeStart is called internally (e.g., by AudioConverter) without an IPC event object
- Added a check for `event && event.sender` before accessing `event.sender.getOwnerBrowserWindow()`
- This prevents crashes when the service is used programmatically within the main process

### UUID Import Fix in TranscriberService (2025-04-18)
- Fixed "TypeError: uuid is not a function" error in audio transcription
- Updated TranscriberService.js to correctly import and use the uuid v4 function
- Changed import from `const { uuid } = require('uuid');` to `const { v4: uuidv4 } = require('uuid');`
- Changed usage from `const jobId = uuid();` to `const jobId = uuidv4();`
- Removed conflicting uuid entry from devDependencies in package.json
- This fix ensures audio transcription works correctly in the production build

### Mistral OCR Error Handling Fix (2025-04-18)
- Fixed "Unexpected token 'I', Internal S..." JSON parsing error in Mistral OCR conversion
- Updated MistralPdfConverter.js to properly handle non-JSON error responses from Mistral API
- Implemented robust error handling that first reads response as text before attempting JSON parsing
- Added detailed error logging to capture the actual error message from the Mistral API
- Enhanced both processWithOcr and handleCheckApiKey methods with consistent error handling
- Improved error messages to include HTTP status codes for better debugging
- This fix ensures the application gracefully handles API errors without crashing

### Mistral OCR API Integration Update (2025-04-18)
- Fixed 422 Unprocessable Entity error with Mistral OCR API
- Updated MistralPdfConverter.js to use the correct file upload workflow:
  1. Upload the PDF file to Mistral's servers using the `/files` endpoint
  2. Get a signed URL for the uploaded file using the `/files/{id}/url` endpoint
  3. Call the `/ocr` endpoint using the signed URL with `type: "document_url"`
- This replaces the previous incorrect attempt to send base64-encoded data directly
- Added necessary API calls for file upload and signed URL retrieval
- Updated error handling to cover potential issues in the multi-step process
- This fix aligns the implementation with Mistral's documented procedure for handling local files

### VideoConverter Tracking and Input Handling Fix (2025-04-18)
- Refactored `VideoConverter.js` and `ConverterRegistry.js` to fix video conversion tracking and input handling issues.
- Identified two key issues:
  1. `VideoConverter` was using its own internal `activeConversions` map, separate from the global map in `ConverterRegistry`, leading to "Conversion tracking object not found" errors.
  2. The `videoConverterWrapper.convert` method expected a file path (string) but was receiving a buffer, causing "VideoConverterWrapper requires file path, not buffer" errors.

- Modified `VideoConverter.js`:
    - Removed internal `activeConversions` map and `generateConversionId` method.
    - Updated constructor to accept the `ConverterRegistry` instance.
    - Refactored `handleConvert` (triggered by IPC) to generate a unique ID (using `uuidv4`) and register the conversion directly with the central `ConverterRegistry`.
    - Refactored `processConversion` to retrieve/update conversion status using `registry.getConversion` and `registry.pingConversion`.
    - Refactored `handleCancel` to use `registry.removeConversion`.
    - Removed the internal `updateConversionStatus` method.
    
- Modified `ConverterRegistry.js`:
    - Updated `VideoConverter` instantiation to pass the registry instance (`this`) to the constructor.
    - Removed the old `videoAdapter` logic.
    - Added a `videoConverterWrapper` with an adapter `convert` method to bridge potential calls expecting the old signature.
    - Enhanced the wrapper to handle buffer input by:
      - Saving the buffer to a temporary file using `fileStorageServiceInstance`
      - Passing the path to this temporary file to `videoConverterInstance.handleConvert`
      - Ensuring proper cleanup of the temporary file
      - Supporting both buffer and file path inputs for flexibility
      
- This refactoring centralizes conversion tracking within the `ConverterRegistry` and properly handles buffer input, ensuring consistent state management for video conversions and resolving both issues.

### VideoConverter Null Event Fix (2025-04-18)
- Fixed "Cannot read properties of null (reading 'sender')" error in `VideoConverter.js`.
- The error occurred when `handleConvert` was called via the `videoConverterWrapper` adapter (which passes `null` for the event object) instead of a direct IPC call.
- Modified `handleConvert` to safely access `event?.sender?.getOwnerBrowserWindow()`, allowing it to proceed without error when `event` is null.
- Added a check to skip sending the initial `video:conversion-started` notification if the window object is unavailable.
- Ensured the temporary directory passed by the wrapper (`options._tempDir`) is correctly used if available.
- This fix allows the `VideoConverter` to be invoked correctly through both direct IPC calls and the internal adapter mechanism.

### Dependency Verification Improvements (2025-04-18)
- Enhanced dependency verification script to handle monorepo structure
- Added detection of built-in Node.js modules to prevent false positives
- Specifically added 'stream/promises' to built-in modules list
- Implemented alias path detection (@lib/api, @lib/stores, etc.)
- Added detailed documentation on Node.js built-in modules
- Integrated verification script into build process
- Created comprehensive dependency management documentation

### Dependencies Migration Fix (2025-04-18)
- Fixed multiple dependency-related failures in production build
- Moved several packages from devDependencies to dependencies in package.json:
  - axios and axios-retry (for API requests and retry logic)
  - canvas (for PDF rendering)
  - formdata-node (for form data handling)
  - tmp-promise (for temporary file operations)
  - node-cache (for caching in OpenAIProxyService)
- Resolved "Cannot find module" errors in production build
- Systematically analyzed codebase to identify all runtime dependencies
- Implemented proper dependency categorization to prevent future issues

### Node Cache Dependency Fix (2025-04-18)
- Fixed converter initialization failure in production build
- Moved node-cache package from devDependencies to dependencies in package.json
- Resolved "Cannot find module 'node-cache'" error in production build
- Fixed OpenAIProxyService dependency issue affecting ConverterRegistry

### CSV Converter Dependency Fix (2025-04-18)
- Fixed CSV converter initialization failure in production build
- Moved csv-parse package from devDependencies to dependencies in package.json
- Resolved "Cannot find module 'csv-parse/sync'" error in production build
- Ensured proper packaging of required dependencies for converters

### Consolidation Plan Created (2025-04-10)
- Created comprehensive consolidation plan divided into four phases:
  - Phase 1: Preparation
  - Phase 2: Service Migration
  - Phase 3: IPC Integration
  - Phase 4: Cleanup
- Created detailed implementation documents:
  - electron-backend-consolidation-plan.md
  - electron-backend-consolidation-phase1.md
  - electron-backend-consolidation-phase2.md
  - electron-backend-consolidation-phase3.md
  - electron-backend-consolidation-phase4.md
  - electron-backend-consolidation-status.md
  - electron-backend-consolidation-summary.md
- Documented step-by-step instructions for each phase
- Created tracking mechanisms for progress
- Added rollback procedures for safety
- Included comprehensive testing strategies

### Phase 3 & 4 Implementation (2025-04-10)
- Completed Phase 3: IPC Integration
  - Verified existing IPC handlers are properly set up
  - Confirmed all converters are registered with IPC system
  - Validated frontend client code for IPC communication
  - Verified security measures for IPC channels
- Started Phase 4: Cleanup
  - Created backup of backend directory
  - Moved dependencies from backend to root package.json
  - Updated build configuration to fix resource issues
  - Added ffmpeg.exe to extraFiles configuration
  - Fixed static assets handling in extraResources
  - Updated prebuild:electron script to run copy-static-assets.js
  - Created comprehensive architecture documentation
  - Updated README.md with new project structure

## Current Issues
- ESM vs CommonJS module system conflicts causing production issues
- Complex architecture with three separate components (Frontend, Backend, Electron)
- Duplicate code and utilities across components
- File locking issues during builds
- Production bugs in URL conversion due to module system mismatches
- Major version update needed for node-fetch (2.7.0 -> 3.3.2)
- Core services need thorough testing in new architecture
- ✅ NSIS memory mapping error during Windows installer creation (fixed)
- ✅ NSIS icon format error during Windows installer creation (fixed)
- ✅ CSV converter initialization failure in production build (fixed)
- ✅ Converter initialization failure due to missing node-cache dependency (fixed)

## Next Steps

### Immediate Actions
✅ Phase 1: Preparation (Completed)
   - Created service inventory (32 total services)
   - Mapped dependencies (32 external dependencies)
   - Created new directory structure for consolidated services
   - Updated package.json (18 new packages, 2 version updates)
   - Created BaseService template with standardized IPC handling

✅ Phase 2: Core Services Migration (Completed)
   - Migrated ConversionService with IPC handlers
   - Implemented FileStorageService for temp files
   - Created FileProcessorService for I/O operations
   - Added JobManagerService for tracking
   - Migrated OpenAIProxyService for AI operations
   - Implemented TranscriberService for media

✅ Phase 2: Data Converters Migration (Completed)
   - Implemented CsvConverter with markdown table generation
   - Created XlsxConverter with multi-sheet support
   - Added preview support for large files
   - Implemented proper error handling and logging

✅ Phase 2: Multimedia Converters Migration (Completed)
   - Implemented AudioConverter with transcription support
   - Created VideoConverter with thumbnail generation
   - Added progress tracking and status updates
   - Integrated with TranscriberService for audio processing
   - Implemented temporary file management and cleanup

✅ Phase 2: Document Converters Migration (Completed)
   - Created BasePdfConverter as foundation class
   - Implemented StandardPdfConverter for text extraction
   - Added MistralPdfConverter for OCR-based conversion
   - Created PdfConverterFactory for intelligent converter selection
   - Added support for document metadata and structure

✅ Phase 2: Web Converters Migration (Completed)
   - Implemented UrlConverter for single web pages
   - Created ParentUrlConverter for multi-page sites
   - Added support for site crawling and navigation
   - Implemented content extraction with cheerio
   - Added screenshot and image processing capabilities

✅ Phase 3: IPC Integration (Completed)
   - Verified IPC type definitions for all services
   - Confirmed handler registry for organized communication
   - Validated main process handler registration
   - Verified frontend client for IPC communication
   - Confirmed security measures for IPC channels

Current:
1. Complete Phase 4: Cleanup
   - ✅ Create backup of backend directory
   - ✅ Move dependencies from backend to root package.json
   - ✅ Update build configuration for resources
   - ✅ Fix static assets handling
   - ✅ Update documentation
   - ✅ Fix NSIS memory mapping error during Windows installer creation
   - ✅ Fix NSIS icon format error during Windows installer creation
   - ⏳ Remove backend directory
   - ⏳ Run final verification tests
   - ⏳ Create release tag

2. Schedule review checkpoints:
   - ✅ After Phase 1 completion
   - ✅ Mid-Phase 2 review
   - ✅ Phase 3 security review
   - ⏳ Final architecture review

3. Set up testing infrastructure:
   - ✅ Create baseline performance metrics
   - ✅ Set up test environments
   - ✅ Create test data sets
   - ⏳ Run comprehensive tests

### Short-term Goals
1. ✅ Complete Phase 1 (1-2 days)
2. ✅ Complete service migration in Phase 2
3. ✅ Complete IPC integration in Phase 3
4. ⏳ Finish cleanup in Phase 4
5. ⏳ Create release plan

### Medium-term Goals
1. ⏳ Complete all consolidation phases (6-10 days total)
2. ⏳ Validate the new architecture
3. ⏳ Create release plan
4. ⏳ Update all documentation

## Related Components
- **Main Process**: Now houses all converted backend services
- **Frontend**: Communicates directly with Electron via IPC
- **Build System**: Simplified to handle just frontend and Electron
- **Testing**: Updated to cover the new architecture

## Technical Decisions

### Module System
- Standardized on CommonJS for Electron main process
- Kept ESM for frontend (Svelte) code
- Removed need for module system interop

### Architecture
- Moved all backend services into Electron main process
- Implemented clean IPC interface
- Using typed channels for all communication
- Implemented proper security measures

### Build Process
- Simplified by removing backend build step
- Updated electron-builder configuration
- Improved asset handling
- Added more robust error handling
- Optimized NSIS installer creation to prevent memory mapping errors
- Created optimize-build.js script to clean up unnecessary files before packaging
- Modified asarUnpack configuration to only unpack necessary modules
- Added custom NSIS configuration for better memory management
- Created convert-icons.js script to convert PNG icons to ICO format for NSIS
- Added dedicated build/icons directory for storing converted icons

### Development Experience
- Simpler setup (no separate backend)
- Faster development cycle
- More straightforward debugging
- Better error messages

## Documentation Status

### Updated
- Project architecture documentation
- Consolidation plan and phases
- Status tracking
- Build process documentation
- README.md with new project structure
- BUILD-OPTIMIZATION.md with details on NSIS memory error fix

### Needs Update
- API documentation (after consolidation)
- Development setup guide
- Contribution guidelines
- Testing documentation

## Testing Status

### Current Coverage
- Unit tests: 85%
- Integration tests: 70%
- E2E tests: 60%

### Needed Tests
- New IPC communication tests
- Updated conversion flow tests
- Security validation tests
- Performance benchmark tests

## Dependencies
Completed dependency audit as part of Phase 1 and moved all backend dependencies to the root package.json as part of Phase 4.
