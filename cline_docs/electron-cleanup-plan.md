# Electron App Cleanup Plan

## Overview
This document outlines the legacy code that can be safely removed after converting the web application to an Electron app. The analysis shows that while the backend code is still being used directly by the Electron app through imports, the web server components are no longer needed.

## Completed Cleanup Actions

1. **Removed Web Server Components**:
   - ✅ Removed `frontend/server.js` - Express server for web deployment
   - ✅ Removed `frontend/src/routes/api/create-zip/+server.js` - API endpoint for ZIP creation

2. **Removed Unnecessary Dependencies**:
   - ✅ Removed from `frontend/package.json`:
     - `archiver` - Used for creating ZIP archives
     - `express` - Used for the web server
     - `@sveltejs/adapter-node` - Used for deploying SvelteKit apps as Node.js servers
     - `file-saver` - Used for saving files in the browser
     - Removed `start` script that referenced server.js

## Additional Recommended Cleanup

1. **Backend Server Components**:
   - `backend/server.js` - The Express server with Socket.IO
   - Socket.IO related code and dependencies in the backend

2. **Web-specific API Endpoints**:
   - Any remaining API endpoints in `frontend/src/routes/api/` that are now handled by Electron IPC

3. **Web-specific Environment Variables**:
   - Review and clean up environment variables in `.env` files that are related to web deployment

4. **Dockerfile and Docker-related Files**:
   - `frontend/Dockerfile` - No longer needed for Electron app
   - `backend/.dockerignore` - No longer needed for Electron app
   - `backend/Dockerfile` - No longer needed for Electron app

## Architecture Notes

The analysis revealed an interesting migration pattern:

1. The Electron app continues to use the backend code, but it imports it directly rather than making API calls to a running server.
2. All adapter classes in `src/electron/adapters/` bridge between the Electron main process and the imported backend code.
3. The frontend no longer makes HTTP requests to backend APIs, instead using Electron IPC to communicate with the main process.

This approach preserves the business logic from the backend while eliminating the need for a separate server process, which is a common and effective pattern for Electron apps.

## Next Steps

1. Consider refactoring the backend code to remove server-specific components while preserving the core business logic.
2. Review the Electron IPC handlers to ensure they properly replace all the functionality that was previously provided by the backend server.
3. Update documentation to reflect the new architecture.