# Technical Context

## Technologies Used
1. **Core Framework & Runtime**
   - Electron (latest LTS)
   - Node.js (>=14.0.0)
   - Svelte (frontend)

2. **Electron Core**
   - electron-builder: Application packaging
   - electron-updater: Auto-updates
   - electron-store: Local storage
   - electron-log: Application logging

3. **File Processing Libraries**
   - @bundled-es-modules/pdfjs-dist: PDF processing
   - mammoth: DOCX processing
   - csv-parse: CSV processing
   - office-text-extractor: Office document handling
   - fluent-ffmpeg: Audio/video processing
   - youtube-transcript: YouTube transcription (online only)

4. **File System Libraries**
   - fs-extra: Enhanced file system operations
   - proper-lockfile: File locking for concurrent access
   - folder-hash: Directory integrity checking
   - sanitize-filename: Safe file name creation
   - file-type: File type detection
   - electron-store: Encrypted storage for settings and API keys

5. **Security Libraries**
   - crypto-js: Encryption for sensitive data
   - keytar: System keychain integration
   - node-machine-id: Machine-specific encryption
   - secure-electron-store: Secure configuration storage

5. **Utility Libraries**
   - turndown: HTML to Markdown conversion
   - node-ipc: Inter-process communication
   - electron-context-menu: Native context menus
   - electron-log: Advanced logging
   - electron-dl: Download management (web content only)

5. **Development Tools**
   - Vite: Build tooling
   - ESLint: Code linting
   - electron-devtools-installer: DevTools
   - electron-reloader: Development reloading
   - TypeScript: Type checking

## Development Setup
1. **Prerequisites**
   - Node.js >= 14.0.0
   - NPM or equivalent package manager
   - Electron development dependencies

2. **Installation**
   ```bash
   npm install
   ```

3. **Development Commands**
   ```bash
   # Start development mode
   npm run dev
   
   # Build for production
   npm run build
   
   # Package application
   npm run package
   ```

## Technical Considerations
1. **File System Integration**
   - Native file system access with fs-extra
   - Atomic file operations for reliability
   - Structured folder organization
   - File locking for concurrent access
   - Watch patterns for file changes
   - Robust error handling
   - Output path management
   - File permission handling

2. **IPC Communication**
   - Context isolation for security
   - Preload scripts configuration
   - Renderer process limitations
   - Main process API design

3. **Desktop Integration**
   - Auto-launch capabilities
   - System tray integration
   - Native notifications
   - Protocol handlers

4. **Application Updates**
   - Auto-update mechanism
   - Version management
   - Update notifications
   - Rollback handling

5. **API Integration**
   - OpenAI Whisper API client
   - API key management system
   - Usage tracking and monitoring
   - Offline capability detection
   - Rate limiting implementation
   - Error handling and retry logic

6. **File Management**
   - Batch processing coordination
   - Asset folder organization
   - File naming conventions
   - Path normalization
   - Concurrent write handling
   - Temporary file cleanup
   - Error recovery procedures
