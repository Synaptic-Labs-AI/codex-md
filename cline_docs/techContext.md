# Technical Context

## Technologies Used

### Core Technologies
- **Electron**: Cross-platform desktop application framework
- **SvelteKit**: Frontend framework for building the user interface
- **Node.js**: Backend runtime for the Electron main process

### Build Tools
- **electron-builder**: Packaging and distribution tool for Electron apps
- **Vite**: Build tool and development server for the frontend
- **TypeScript/JavaScript**: Primary programming languages

### Key Libraries
- **fs-extra**: Enhanced file system operations
- **path**: Path manipulation utilities
- **electron-store**: Persistent storage for application settings
- **puppeteer**: Web scraping and browser automation

## Development Setup
- **Development Mode**: Uses a local development server (http://localhost:5173) with hot reloading
- **Production Build**: Packages the application with electron-builder
- **Cross-Platform**: Supports Windows and macOS

## Technical Constraints

### Electron Constraints
- **ASAR Packaging**: Application files are packaged in an ASAR archive in production
- **Protocol Handling**: Custom protocol handlers are needed for loading assets
- **Context Isolation**: Main and renderer processes are isolated for security
- **Preload Scripts**: Used for secure communication between processes

### Windows-Specific Constraints
- **Path Handling**: Windows paths with drive letters require special handling
- **Backslash vs. Forward Slash**: Path separators differ from Unix-like systems
- **File Protocol**: The file:// protocol behaves differently on Windows

### SvelteKit Constraints
- **Static Adapter**: Uses adapter-static for building static files
- **Asset Paths**: Requires careful configuration for proper asset loading
- **Routing**: SvelteKit's router can interfere with Electron's file loading

## Dependencies

### Critical Dependencies
- **@codex-md/shared**: Shared utilities and types
- **electron**: Core Electron framework
- **electron-builder**: Packaging and distribution
- **fs-extra**: Enhanced file system operations
- **path**: Path manipulation utilities

### Development Dependencies
- **@electron-forge/cli**: Electron development tools
- **concurrently**: Run multiple commands concurrently
- **cross-env**: Set environment variables across platforms
- **electron-devtools-installer**: Install DevTools extensions

## Technical Decisions

### Protocol Handling
- **Enhanced file:// Protocol**: Custom handler for proper asset resolution
- **ASAR-aware Paths**: Special handling for packaged applications
- **Windows Path Handling**: Special handling for Windows paths with drive letters

### Asset Management
- **Static Assets**: Stored in frontend/static
- **Build Assets**: Generated in frontend/dist
- **Verification**: afterPack script verifies and copies critical assets

### Error Handling
- **Detailed Logging**: Comprehensive logging for debugging
- **Recovery Mechanisms**: Fallbacks and retries for asset loading failures
- **User Feedback**: Clear error messages for unrecoverable errors
