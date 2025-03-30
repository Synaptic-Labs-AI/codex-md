## To Do

8. src/routes/+page.svelte
The conductor:

Organize component layout
Add proper spacing
Implement responsive behavior
Add section transitions
Create loading states

9. src/lib/components/FileItem.svelte
The list item warrior:

Design card layout
Add file type icons
Style metadata
Create hover effects
Add remove button animations

Implementation Order:

Global Styles (foundation)
Layout Template (structure)
ApiKeyInput (entry point)
FileUploader (main interaction)
FileList & FileItem (content display)
ConversionStatus (feedback)
ResultDisplay (output)
Page Assembly (final integration)

# Obsidian Note Converter Frontend Documentation

## Project Overview

The Obsidian Note Converter is a web application built with SvelteKit that converts various file formats into Obsidian-compatible Markdown notes. It features a drag-and-drop interface, real-time conversion status updates, and the ability to download converted files individually or in batch.

## Directory Structure and File Purposes

### src/ Directory

The `src/` directory contains the core application code.

#### lib/ Directory

The `lib/` directory houses reusable components, stores, utility functions, and constants.

##### components/

- **FileUploader/**
  - `FileUploader.svelte`: Implements the file upload interface, including drag-and-drop and click-to-upload functionality. It handles file selection and initiates the upload process.
  - `useFileUpload.js`: A custom action that manages the file upload logic, including handling the drag events and file selection. It communicates with the file store to update the application state with uploaded files.
- `ConversionStatus.svelte`: Displays a real-time progress indicator for the file conversion process. It subscribes to the conversionStatus store and updates the UI accordingly.
- `ResultDisplay.svelte`: Renders the list of converted files, providing options to download individual files or all files as a zip. It interfaces with the files store to access conversion results.
- `ObsidianNoteConverter.svelte`: The main component that orchestrates the entire conversion process. It combines the FileUploader, ConversionStatus, and ResultDisplay components, and manages the overall flow of the application.

##### stores/

- `apiKey.js`: Manages the state of the user's API key, providing functions to set, get, and clear the key. It may also handle validation and secure storage of the API key.
- `files.js`: Handles the state of uploaded and converted files. It provides methods to add new files, update file statuses, and remove files from the application state.
- `conversionStatus.js`: Manages the state of the conversion process, including overall progress, current file being processed, and any errors encountered during conversion.
- `index.js`: Acts as a central export point for all stores, allowing components to import multiple stores with a single import statement.

##### utils/

- **api/**
  - `client.js`: Implements the API client for communicating with the backend. It includes methods for sending requests, handling responses, and managing authentication.
  - `endpoints.js`: Defines and exports all API endpoints used in the application as constants, ensuring consistency in API calls across the application.
- `fileHandler.js`: Contains utility functions for file operations, such as reading file contents, checking file types, and preparing files for upload or download.
- `validators.js`: Implements validation functions for user inputs (e.g., API key format) and file types, ensuring data integrity before processing.

##### constants.js

Defines application-wide constants such as supported file types, maximum file sizes, and any configuration options used across multiple components.

#### routes/

- **api/**
  - **create-zip/**
    - `+server.js`: Implements a server-side endpoint for creating zip files of converted notes. It handles the request to bundle multiple converted files into a single downloadable zip file.
- `+page.svelte`: The main page component of the application. It typically includes the ObsidianNoteConverter component and may handle page-specific logic or layouts.
- `+layout.svelte`: The layout component that wraps all pages. It typically includes common elements like headers, footers, and navigation, and is responsible for importing and applying global styles.

#### styles/

- `global.css`: Contains global styles applied to the entire application, including reset styles, typography, and any application-wide CSS custom properties.

#### app.html

The main HTML template for the SvelteKit application. It includes the basic HTML structure, meta tags, and any necessary script or style tags that should be present on every page.

### static/ Directory

Contains static assets served directly to clients, such as the favicon.png which is the icon displayed in the browser tab.

### tests/ Directory

Houses all test files for the application, including unit tests for utility functions, component tests, and end-to-end tests for critical user flows.

### Configuration Files

- `.env`: Stores environment variables for the project, such as API URLs or feature flags. This file is not tracked in git to keep sensitive information secure.
- `.gitignore`: Specifies files and directories that should be ignored by git, such as node_modules, build outputs, and environment-specific files.
- `package.json`: Defines project dependencies, scripts for development, testing, and building, and other project metadata.
- `README.md`: Contains project documentation, including a brief description, setup instructions, and any other relevant information for developers.
- `svelte.config.js`: Configures SvelteKit settings, including the adapter for deployment, preprocessing options, and any SvelteKit-specific configurations.
- `vite.config.js`: Configures Vite settings, including plugins (like the SvelteKit plugin), resolve aliases for easier imports, and any other build-related configurations.

## Key Features

1. **File Upload**: Supports drag-and-drop and click-to-upload functionality for selecting files to convert.
2. **Conversion Process**: Converts various file formats to Obsidian-compatible Markdown using a backend service.
3. **Real-time Status Updates**: Provides users with current conversion status and progress information.
4. **Results Display**: Shows converted files and allows for individual or batch downloads of converted notes.
5. **API Integration**: Communicates with a backend service for file conversion, handling authentication and data transfer.
6. **Responsive Design**: Ensures a consistent user experience across different device sizes and types.

## File Size Limits

The application enforces the following file size limits to ensure optimal performance:

- **Video Files**: Maximum 500MB per file (formats: mp4, webm, avi, mov, mkv)
- **All Other Files**: Maximum 50MB per file (including documents, audio, and data files)

These limits are enforced on the frontend to prevent unnecessary upload attempts of oversized files. Attempting to upload files larger than these limits will result in a user-friendly error message.
