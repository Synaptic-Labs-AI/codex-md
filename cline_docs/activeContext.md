# Active Context

## Current Focus
Transitioning to Phase 4: Desktop Features - Implementing system tray integration, native notifications, file associations, and auto-updates while enhancing frontend components for native file operations and completing the IPC implementation for all conversion types.

- Implementing a standardized attachment folder structure for images extracted from PDFs and slides
- Enhancing URL and Parent URL conversion with Puppeteer for better content extraction

## Recent Changes
- Fixed Batch Conversion Named Export Error:
  - Fixed "Named export 'ConversionService' not configured" error in batch conversion
  - Updated ConversionServiceAdapter to properly handle named exports
  - Modified constructor to use the correct pattern for ES module imports
  - Changed from using default export to named export configuration
  - Aligned with the pattern used in other adapters like MetadataExtractorAdapter
  - Ensured proper initialization of the ConversionService class
  - Fixed the root cause of batch conversion failures
  - Improved module loading and error handling for ES modules

- Improved Large File Transfer Performance:
  - Increased chunk size from 5MB to 24MB for faster file transfers
  - Updated client to pass chunk size to server during initialization
  - Modified server to use client-specified chunk size
  - Added better logging of chunk size and transfer statistics
  - Reduced number of chunks needed for large video files
  - Improved transfer speed for large video files
  - Enhanced documentation in IPC types

- Fixed Video Converter Adapter Error:
  - Fixed "Method 'convertToMarkdown' not found in export 'default'" error in video conversion
  - Updated VideoConverterAdapter to properly handle class-based exports
  - Added instance initialization pattern to match AudioConverterAdapter
  - Modified adapter to instantiate the VideoConverter class before calling methods
  - Improved error handling and logging for video conversion
  - Ensured consistency with other adapters in the codebase
  - Fixed the root cause of video conversion failures

- Fixed Video Conversion Error:
  - Fixed "Cannot read properties of undefined (reading 'length')" error in video conversion
  - Implemented robust null/undefined checks in saveTempFile function
  - Added special handling for large video files with chunked file transfer
  - Created new IPC handlers for large file transfer operations
  - Implemented client-side chunking of large files to avoid memory issues
  - Added progress tracking for large file transfers
  - Enhanced error handling and cleanup for temporary files
  - Improved logging for better diagnostics
  - Added validation of transferred data to ensure integrity

- Enhanced PDF Image Organization:
  - Modified BasePdfConverter.js to use PDF-specific image folders
  - Changed image path format from `images/filename-p1-uuid.ext` to `filename - images/filename-p1-uuid.ext`
  - Updated ConversionResultManager.js to create separate image folders for each PDF
  - Implemented directory grouping to handle multiple image directories
  - Ensured proper path handling for both single files and batch operations
  - Maintained compatibility with existing image reference handling
  - Improved organization of extracted images, especially for batch conversions
  - Each PDF now has its own dedicated images folder clearly associated with its source

- Fixed Image Links in PDF Conversion:
  - Modified MistralPdfConverter.js to properly handle image references in OCR results
  - Created a mapping between Mistral's image IDs and our generated image paths
  - Replaced standard Markdown image links with Obsidian format (![[imagename.type]])
  - Removed the separate "Extracted Images" section at the end of the document
  - Enhanced ConversionResultManager.updateImageReferences to better handle image references
  - Added a generic pass to handle standard Markdown image links
  - Added tracking of processed image IDs to avoid duplicate processing
  - Added cleanup of any remaining "Extracted Images" sections
  - Ensured all image references appear inline where they should in the text

- Fixed PDF OCR Conversion Error:
  - Fixed "this.createFrontmatter is not a function" error in MistralPdfConverter.js
  - Updated MistralPdfConverter to use createMetadata method from BasePdfConverter
  - Modified MistralPdfConverter to return metadata separately in the result object
  - Aligned MistralPdfConverter with StandardPdfConverter's approach to metadata handling
  - Ensured consistent architecture where ConversionResultManager handles frontmatter formatting

- Enhanced WelcomeChat Modal UI and Navigation:
  - Updated WelcomeChat.svelte to use SvelteKit's client-side navigation
  - Replaced window.location.href with goto() from '$app/navigation'
  - Ensured modal is properly closed before navigation with handleMinimize()
  - Changed API key link from anchor tag to button with proper styling
  - Added link-button class for consistent styling of button-as-link elements
  - Improved user experience by maintaining application state during navigation
  - Fixed potential issues with full page reloads during navigation
  - Adjusted wave button position (moved up and to the left) for better visibility and accessibility
  - Modified wave button to only appear on startup and disappear permanently when closed
  - Updated modal visibility to respect the welcomeState store value
  - Prevented reopening of welcome modal after it has been dismissed
  - Ensured consistent behavior across all dismiss actions (X button, Help Guide, I'm Ready)

- Fixed Chat Bubble Avatar Display and Scrolling Issues:
  - Completely restructured ChatBubble.svelte component for proper avatar display
  - Moved avatars outside the chat bubble to create a layered effect
  - Changed the DOM structure to position avatars after the chat bubble in the markup
  - Fixed horizontal and vertical scrolling issues in chat bubbles
  - Adjusted avatar size and positioning for better visual appearance
  - Modified WelcomeChat.svelte to use visible overflow instead of auto
  - Improved responsive behavior with proper box-sizing
  - Ensured content fits without requiring scrolling
  - Fixed issue with book emoji covering text by adjusting padding

- Enhanced URL and Parent URL Conversion with Puppeteer:
  - Replaced Cheerio and Got with Puppeteer for better content extraction
  - Implemented browser instance management for efficient resource usage
  - Added support for modern web frameworks (React, Vue, Angular, etc.)
  - Enhanced content scoring to better identify main content areas
  - Added fallback to body content when specific selectors don't find enough content
  - Enhanced SPA detection and waiting logic for dynamic content
  - Added proper metadata extraction from rendered pages
  - Improved image extraction from rendered pages
  - Added URL normalization to prevent duplicate pages
  - Implemented tracking of both normalized and original URLs
  - Ensured unique pages in the output by using normalized URLs as keys
  - Fixed frontmatter generation for individual pages in parent URL conversion
  - Enhanced error handling and resource cleanup
  
- Implemented Browser Service for Puppeteer:
  - Created a new BrowserService to manage a single Puppeteer browser instance
  - Implemented lazy initialization to start browser only when needed
  - Added browser instance sharing between URL and Parent URL converters
  - Modified urlConverter.js and parentUrlConverter.js to accept external browser instances
  - Updated adapters to use the shared browser instance
  - Added proper cleanup of browser resources on application exit
  - Improved error handling for browser operations
  - Enhanced content extraction with better HTML cleanup
  - Fixed JavaScript variable assignments in HTML that caused parsing issues
  - Added comprehensive cleanup of cookie notices, popups, and other distractions
  - Improved content scoring algorithm to better identify main content

- Fixed Batch Conversion and DOCX Handling Issues:
  - Fixed "ConversionError: An object could not be cloned" error in batch conversion
  - Modified batch conversion process to properly handle File objects
  - Implemented temporary file handling for browser File objects in batch conversion
  - Added proper cleanup of temporary files after batch conversion
  - Ensured serializable data is passed through IPC channels
  - Added detailed progress tracking for batch conversion
  - Improved error handling with proper cleanup in failure cases
  - Added batch output path to conversion result to fix "No output path returned" error
  - Created batch summary file with conversion details
  - Fixed "Invalid input: Expected buffer or Uint8Array, got string" error in DOCX conversion
  - Added DOCX to the list of binary file types to ensure proper handling
  - Fixed "Cannot read properties of undefined (reading 'length')" error in DOCX conversion
  - Added robust null/undefined checks in DocxConverterAdapter
  - Enhanced PageMarkerService with comprehensive error handling
  - Improved validation of inputs in page marker insertion
  - Added fallback mechanisms for page break calculation
  - Fixed transformDocument function in docxConverter.js to handle paragraphs without content
  - Added try/catch blocks to prevent errors in paragraph transforms
  - Improved error logging for DOCX conversion issues
  - Changed DOCX conversion to use HTML output and then convert to Markdown
  - Added HTML to Markdown conversion using existing web converter code
  - Added new HTML file converter for direct HTML to Markdown conversion
  - Added HTML converter adapter for Electron integration
  - Updated textConverterFactory to support HTML files
  - Added HTML and HTM file types to supported file types in frontend

- Fixed Page Numbering Issues:
  - Fixed duplicate page/slide numbering in PPTX and PDF conversions
  - Modified PPTX converter adapter to keep original "## Slide X" headers and not add duplicate "[Slide X]" markers
  - Updated PDF converter to standardize page marking approach
  - Modified backend PDF converter to track page break positions without adding markers directly
  - Updated PDF converter adapter to use PageMarkerService for consistent page marking
  - Ensured consistent page numbering across all document types

- Enhanced PPTX Conversion Diagnostics:
  - Added detailed logging throughout the PPTX conversion process
  - Implemented file integrity validation in pptxConverter.js
  - Added ZIP signature (PK header) verification for PPTX files
  - Enhanced base64 encoding/decoding with size verification
  - Improved temporary file handling with detailed stats logging
  - Added comprehensive error handling for binary data transmission
  - Fixed "Corrupted zip: missing bytes" error by validating file integrity
  - Aligned PPTX converter structure with other converters like PDF

- Added PPTX Support:
  - Added 'pptx' to the supported file types in frontend/src/lib/api/electron/utils.js
  - Fixed "Unsupported file type: pptx" error in file uploader
  - Ensured PPTX files can be properly converted to Markdown
  - Leveraged existing PPTX converter implementation in backend

- Fixed PDF Conversion Errors:
  - Fixed "formatMetadata is not a function" error in PDF conversion
  - Fixed "determineCategory is not a function" error in PDF conversion
  - Fixed duplicate metadata in converted files by centralizing metadata handling
  - Enhanced metadataExtractorAdapter.js to use BaseModuleAdapter pattern
  - Fixed BaseModuleAdapter to properly handle modules with only named exports
  - Implemented robust fallback functions for when modules haven't loaded yet
  - Added synchronous fallback methods with identical behavior to real functions
  - Improved error handling for ES module imports in CommonJS environment
  - Ensured PDF files can be properly converted even during module loading
  - Added comprehensive logging for module loading and function execution
  - Implemented proper error recovery for metadata formatting
  - Modified BasePdfConverter to return metadata as a separate property
  - Updated ConversionResultManager to be the single source of truth for frontmatter
  - Updated URL converter to not add its own frontmatter

- Fixed Binary Data Transmission Error:
  - Fixed "Failed to write temporary file: The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received type number (37)" error
  - Fixed "Buffer is not defined" error in browser environment
  - Updated saveTempFile function in conversionManager.js to properly handle binary data
  - Changed to use base64 encoding for binary data transmission over IPC
  - Simplified temp directory handling by using a default value
  - Ensured proper binary data handling for all file types (docx, audio, video, etc.)
  - Leveraged browser-compatible approach for binary data transmission

- Fixed File System Operations in Electron:
  - Fixed "electronClient.createDirectory is not a function" error
  - Updated imports to include fileSystemOperations from electron API
  - Modified saveTempFile to use fileSystemOperations.createDirectory instead of electronClient.createDirectory
  - Modified saveTempFile to use fileSystemOperations.writeFile for writing temporary files
  - Updated cleanupTempFile to use fileSystemOperations.deleteItem for cleanup
  - Ensured proper separation of concerns between client and file system operations

- Fixed File Object Conversion in Electron:
  - Implemented support for converting browser File objects in Electron environment
  - Added saveTempFile function to save File objects to temporary files on disk
  - Added cleanupTempFile function to remove temporary files after conversion
  - Updated handleElectronConversion to handle File objects properly
  - Added proper progress tracking for temporary file operations
  - Ensured cleanup happens even if conversion fails

- Fixed PDF Conversion Error:
  - Fixed "Unsupported type: pdf" error in file conversion
  - Updated validateAndNormalizeItem function in utils.js to properly handle specific file types
  - Added getFileCategory helper function to map file extensions to categories
  - Improved validation logic to check both category names and specific file types
  - Ensured PDF files can be properly converted to Markdown

- Fixed Chat Bubble Persistence Issue:
  - Created a new welcomeState store to track if welcome messages have been shown
  - Modified CodexMdConverter.svelte to only show welcome messages on first app load
  - Added subscription cleanup in component unmount to prevent memory leaks
  - Updated stores/index.js to export the new welcomeState store
  - Ensured chat bubbles don't reappear when navigating between pages
  - Implemented session-based persistence for welcome message state

- Fixed Event Handling Error:
  - Fixed "Cannot destructure property 'type' of 'event.data' as it is undefined" error
  - Added null/undefined checks in eventHandlers.js for all event handlers
  - Implemented defensive programming to handle missing event data
  - Added error logging for undefined data in event handlers
  - Added a utility method to safely extract data from events
  - Enhanced the getActiveJobs method to support job cancellation

- Fixed URL Conversion Error:
  - Fixed "Cannot read properties of undefined (reading 'includes')" error in URL conversion
  - Added default value for supportedTypes parameter in validateAndNormalizeItem function
  - Updated function documentation to reflect the optional parameter
  - Ensured single URL conversion works properly in Electron environment

- Fixed Missing ErrorUtils Export:
  - Added ErrorUtils object to errors.js to fix import errors
  - Implemented missing wrap() function for error handling
  - Fixed SyntaxError in requestHandler.js, converters.js, and client.js
  - Resolved "The requested module '/src/lib/api/errors.js' does not provide an export named 'ErrorUtils'" error

- Implemented Modular Electron Client Architecture:
  - Refactored electronClient.js into a modular structure in frontend/src/lib/api/electron/
  - Created utils.js for common utility functions like ID generation and URL normalization
  - Implemented eventHandlers.js for proper event registration and status updates
  - Added fileSystem.js for file system operations
  - Created specialized converters for different file types
  - Fixed "conversionStatus.update is not a function" error in URL conversion
  - Updated all components to use the new modular structure
  - Added comprehensive error handling system

- Implemented UI Improvements and Backend Refactoring:
  - Added a header and logo with a new Logo component
  - Fixed and improved the styling of the offline indicator status bar
  - Fixed clickability issues by adding proper ARIA roles and keyboard event handlers
  - Put instructions on their own page in the help section
  - Removed payment/stripe functionality
  - Removed socket connection
  - Enhanced API key input implementation
  - Created a dedicated help page with comprehensive instructions

- Implemented Folder Selection Enhancement:
  - Enhanced FileSystemService with detailed directory listing
  - Added IPC handlers for folder operations
  - Created FolderSelector.svelte component
  - Updated FileUploader to support folder selection
  - Added folder browsing capabilities
  - Implemented file selection from folder browser
  - Added support for filtering by file type
  - Integrated with existing file conversion workflow

- Previous Changes:
  - Created comprehensive implementation plan for desktop features:
  - Prioritized system tray integration, native notifications, folder selection, and drag & drop
  - Defined detailed implementation steps for each desktop feature
  - Organized implementation into four phases with clear dependencies
  - Established testing and validation requirements for each component
  - Created timeline with prioritized tasks based on user impact

- Implemented URL, Parent URL, and YouTube Conversion via IPC:
  - Added URL conversion methods to ElectronConversionService
  - Added Parent URL conversion methods to ElectronConversionService
  - Added placeholder for YouTube conversion (currently disabled)
  - Updated IPC types with new message types and channels
  - Added IPC handlers for URL, Parent URL, and YouTube conversion
  - Updated preload script to expose new IPC channels
  - Enhanced electronClient.js with methods for all conversion types
  - Updated conversionManager.js to properly route conversions

- Previous Analysis:
  - Identified gaps in electronClient.js implementation
  - Found missing IPC handlers for URL, YouTube, and parent URL conversion
  - Discovered socket-based communication that needs IPC replacement
  - Identified UI components that need enhancement for native file support
  - Created comprehensive list of refactoring needs

- Implemented Secure API Key Management:
  - Created ApiKeyService with machine-specific encryption
  - Implemented API key validation, storage, and retrieval
  - Set up IPC handlers for API key operations
  - Added OpenAI API validation
  - Created frontend settings UI for API key management
  - Implemented transcription service using secure API keys
  - Added navigation and settings page to frontend

- Previous Completion:
  - Implemented Offline Support System:
    - Created OfflineService with caching system
    - Added operation queue for pending tasks
    - Implemented state persistence for offline mode
    - Added sync mechanisms for reconnection
    - Set up IPC handlers for offline functionality
    - Updated preload API for renderer access
    - Created frontend components for offline status
    - Implemented offline-aware API client

- Previous Completion:
  - Implemented File Watcher System:
    - Created FileWatcherService with chokidar integration
    - Added file locking with proper-lockfile
    - Implemented event forwarding to renderer
    - Set up IPC handlers for file watching
    - Added cleanup on application exit
    - Updated preload API for renderer access

- Previous Completion:
  - Implemented ElectronConversionService with native file handling
  - Created secure FileSystemService with validation
  - Set up IPC handlers for both services
  - Updated type definitions and preload APIs
  - Removed ZIP dependencies with structured output
  - Implemented direct file system access
  - Added progress tracking and error handling

## Active Decisions

1. **Completed Foundations**
   - Electron architecture with secure IPC communication ✓
   - Main process for system operations ✓
   - Renderer process using Svelte for UI ✓
   - Context isolation for security ✓
   - Machine-specific encryption for settings ✓
   - Native file system operations ✓
   - File system IPC handlers ✓
   - Basic conversion service migration ✓
   - File watching system ✓
   - Offline support system ✓
   - Secure API key storage ✓
   - Transcription service integration ✓
   - Modular Electron client architecture ✓
   - Proper event handling for conversions ✓
   - Enhanced URL and Parent URL conversion with Puppeteer ✓

2. **Current Implementation Gaps**
   - Socket-based communication replacement with IPC ⚠️
   - Drag & drop enhancements for folders ⚠️

3. **Next Phase Strategy**
   - Phase 1: Desktop Features Implementation
     - System tray integration with context menu and recent files
     - Native notifications for conversion events and errors
     - File associations for .md and .markdown files
     - Auto-updates with electron-updater
   
   - Phase 2: Frontend Enhancements
     - Folder selection dialogs with proper IPC handlers ✓
     - Enhanced drag & drop with folder support
     - Improved progress tracking for batch conversions
     - Enhanced result display for native file paths
   
   - Phase 3: Communication Updates
     - Replace socket-based communication with IPC
     - Update UI components for native file operations
   
   - Phase 4: Testing & Optimization
     - Cross-platform testing
     - Performance optimization

## Implementation Progress

1. **Core Services Partially Complete**
   - Native file system operations ✓
   - Secure path handling ✓
   - Basic conversion pipeline ✓
   - Basic progress tracking ✓
   - Error handling ✓
   - IPC communication framework ✓
   - File watching system ✓
   - Lock management ✓
   - Offline support system ✓
   - Operation queueing ✓
   - Caching system ✓
   - API key secure storage ✓
   - Transcription service ✓
   - URL conversion in Electron ✓
   - YouTube conversion in Electron ✓ (placeholder)
   - Parent URL conversion in Electron ✓
   - Batch conversion with progress tracking ✓
   - Modular Electron client architecture ✓
   - Comprehensive error handling system ✓
   - Enhanced URL and Parent URL conversion with Puppeteer ✓

2. **Next Focus Areas**
   - High Priority:
     - System tray integration ✓
     - Native notifications ✓
     - Folder selection dialogs ✓
     - Drag & drop enhancements
   
   - Medium Priority:
     - File associations
     - Progress tracking improvements
     - Result display enhancements
     - IPC replacement for socket communication
   
   - Lower Priority:
     - Auto-updates
     - UI component updates
     - Performance optimization

## Current Challenges

1. **Technical Considerations**
   - Replacing socket-based communication with IPC
   - Concurrent file access management
   - Cross-platform path handling
   - Memory management for large files
   - Progress reporting accuracy
   - Error recovery strategies
   - Frontend adaptation
   - Network status detection
   - Cache invalidation strategies
   - API key security
   - System tray integration
   - Native notifications
   - File associations
   - Auto-updates

2. **Integration Tasks**
   - Enhance event handling system
   - Improve progress visualization
   - Refine error feedback
   - Enhance file selection UI
   - Optimize offline status indicators
   - Improve operation queue management
   - Implement folder selection dialogs
   - Add direct file system integration
   - Add drag-and-drop support
   - Implement system tray integration
   - Add native notifications

## Immediate Tasks

1. **System Tray Integration**
   - Create `src/electron/features/tray.js` module
   - Implement tray icon with context menu
   - Add recent files submenu
   - Integrate with main window management
   - Add platform-specific tray behaviors

2. **Native Notifications**
   - Create `src/electron/features/notifications.js` module
   - Implement conversion completion notifications
   - Add error notifications
   - Configure platform-specific notification settings
   - Connect to conversion events

3. **Drag & Drop Improvements**
   - Improve native file drag & drop handling
   - Add folder drag & drop support
   - Enhance drop zone with visual feedback
   - Implement proper file type validation

## Notes and Considerations

- Test all conversion paths in both web and Electron environments
- Ensure proper error handling and progress reporting
- Validate offline functionality for all conversion types
- Test edge cases like large files, network interruptions
- Test API key storage security thoroughly
- Verify transcription service with various audio/video formats
- Consider platform differences in file handling
- Monitor memory usage with large files
- Document API changes for frontend developers
- Update frontend guides for desktop workflows
- Consider error scenarios during API operations
- Optimize large file handling

## TODOs

1. **Assets and Resources**
   - Create proper tray icon for system tray integration (currently using placeholder)
   - Create notification icons for different notification types:
     - Success icon for completed conversions
     - Error icon for conversion errors
     - Online/offline status icons
     - Update notification icon
     - File change notification icon
   - Add a header and logo

2. **Implementation Refinements**
   - Complete the remaining parent URL and YouTube conversion notification handlers
   - Add proper error handling for edge cases in tray and notification managers
   - Test system tray and notifications on all supported platforms (Windows, macOS, Linux)
   - Ensure proper cleanup of resources when application exits
   - ✓ Remove strip functionality
   - ✓ Remove socket connection
   - ✓ Figure out API key input
   - ✓ Put instruction on own page in help
   - ✓ Fix and make better styled online indicator status bar
   - ✓ Fix clickability issues (nothing is currently clickable)
   - ✓ Add a header and logo
   - ✓ Fix URL conversion error with modular architecture
   - ✓ Enhance URL and Parent URL conversion with Puppeteer
