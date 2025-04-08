# System Patterns

## Architecture Overview
Codex MD follows an Electron architecture with a clear separation between the main process and renderer process:

1. **Main Process** (Node.js)
   - Handles system-level operations
   - Manages windows and application lifecycle
   - Provides IPC communication
   - Registers protocol handlers

2. **Renderer Process** (SvelteKit)
   - Provides the user interface
   - Handles user interactions
   - Communicates with the main process via IPC

## Key Technical Patterns

### Protocol Handling Pattern
The application uses enhanced protocol handlers to serve static assets in the Electron environment, which is particularly important for Windows compatibility.

```mermaid
flowchart TD
    A[SvelteKit App] -->|Requests Asset| B[Browser Engine]
    B -->|file:// Protocol| C[Custom Protocol Handler]
    C -->|Maps to Filesystem| D[Asset Resolution]
    D -->|ASAR-aware Path| E[Static Asset]
    
    subgraph Asset Resolution
        F[Check Windows Path] --> G[Handle Static Assets]
        G --> H[Handle SvelteKit Assets]
        H --> I[Handle index.html]
    end
```

#### Implementation Details
- **Enhanced file:// Protocol Handler**: Intercepts file:// requests and maps them to the correct locations in the filesystem
- **Windows Path Handling**: Special handling for Windows paths with drive letters
- **Static Asset Resolution**: Maps requests for static assets to the correct locations
- **ASAR-aware Path Resolution**: Ensures paths work correctly in packaged apps with ASAR archives
- **Fallback Mechanisms**: Implements retries and fallbacks for asset loading failures

### Static Asset Management
The application ensures static assets are properly handled in both development and production environments.

```mermaid
flowchart TD
    A[Build Process] --> B[SvelteKit Build]
    B --> C[Static Assets]
    C --> D[Electron Packaging]
    D --> E[afterPack Script]
    E --> F[Verify Assets]
    F --> G[Copy Missing Assets]
```

#### Implementation Details
- **SvelteKit Configuration**: Uses relative paths for assets
- **Electron Builder Config**: Includes both dist and static directories
- **afterPack Script**: Verifies critical assets exist and copies them if needed
- **Path Normalization**: Ensures consistent path handling across platforms

### Error Handling and Recovery
The application implements robust error handling and recovery mechanisms for asset loading failures.

```mermaid
flowchart TD
    A[Asset Request] --> B{Load Success?}
    B -->|Yes| C[Render App]
    B -->|No| D[Log Error]
    D --> E[Attempt Recovery]
    E --> F{Recovery Success?}
    F -->|Yes| C
    F -->|No| G[Show Error UI]
```

#### Implementation Details
- **Detailed Logging**: Logs all asset requests and errors
- **Retry Mechanism**: Implements delayed retries for failed loads
- **Fallback Paths**: Tries alternative paths for critical assets
- **User Feedback**: Provides clear error messages when recovery fails

### File Locking Prevention
The application implements strategies to prevent file locking issues during the build process, which is particularly important on Windows.

```mermaid
flowchart TD
    A[Build Process] --> B[Pre-build Cleanup]
    B --> C[Resource Separation]
    C --> D[Retry Logic]
    D --> E[Electron Packaging]
    
    subgraph Pre-build Cleanup
        F[Check File Locks] --> G[Release Handles]
        G --> H[Remove Temp Files]
    end
    
    subgraph Resource Separation
        I[Dedicated Icon Files] --> J[UI vs Build Assets]
    end
    
    subgraph Retry Logic
        K[Detect EBUSY] --> L[Delayed Retry]
        L --> M[Continue on Failure]
    end
```

#### Implementation Details
- **Dedicated Resource Files**: Separates files used for different purposes (e.g., app-icon.png vs. logo.png, favicon-icon.png vs. favicon.png)
- **Resource Duplication Strategy**: Creates dedicated copies of assets that serve multiple purposes to avoid file locking
- **Pre-build Cleanup**: Ensures no file handles are open before the build process starts
- **Retry Logic**: Implements delayed retries for file operations that encounter EBUSY errors
- **Graceful Failure**: Continues the build process even if some non-critical file operations fail
- **Enhanced Logging**: Provides detailed information about file operations and locking issues

### SvelteKit Asset Path Resolution
The application implements enhanced path resolution for SvelteKit-generated assets, which is critical for proper loading in the Electron environment.

```mermaid
flowchart TD
    A[Asset Request] --> B[Parse URL]
    B --> C{Path Pattern?}
    C -->|Static Asset| D[Map to Static Dir]
    C -->|_app/immutable| E[Map to _app Dir]
    C -->|Standard SvelteKit| F[Map to Dist Dir]
    C -->|Direct File| G[Map to Root]
    C -->|Other| H[Standard Resolution]
    
    D --> I[Return File Path]
    E --> I
    F --> I
    G --> I
    H --> I
```

#### Implementation Details
- **Pattern Recognition**: Identifies different SvelteKit asset path patterns
- **Special Case Handling**: Implements specific handlers for different path formats
- **_app/immutable Pattern**: Special handling for newer SvelteKit build output format
- **Direct File Requests**: Handles cases where files are referenced without a path
- **Enhanced Logging**: Detailed logging of path resolution for debugging

## Cross-Platform Considerations

### Windows-Specific Patterns
- **Drive Letter Handling**: Special handling for Windows paths with drive letters (e.g., C:/)
- **Backslash Normalization**: Handles both forward and backslashes in paths
- **ASAR Path Resolution**: Ensures paths work correctly in ASAR-packaged apps on Windows
- **File Locking Handling**: Implements strategies to deal with stricter file locking on Windows

### Development vs. Production
- **Development Mode**: Uses local dev server with hot reloading
- **Production Mode**: Uses file:// protocol with enhanced path resolution
- **Static Asset Handling**: Different paths for development and production
- **Build Process**: Different strategies for development builds vs. production packaging
