# Phase 6: Clean Up and Testing

This document provides detailed step-by-step instructions for cleaning up the project and testing the changes as part of the shared package restructuring.

## 1. Remove Shared Package References

### Step 1.1: Update Main package.json

Update `package.json` to remove the shared package from workspaces and dependencies:

```json
{
  "workspaces": [
    "frontend",
    "backend"
    // Remove "shared" from workspaces
  ],
  "dependencies": {
    // Remove "@codex-md/shared": "file:shared" dependency
  }
}
```

### Step 1.2: Update Build Scripts

Update build scripts in `package.json` to remove shared package build steps:

```json
{
  "scripts": {
    "dev": "cross-env NODE_ENV=development concurrently \"npm run dev:svelte\" \"npm run dev:electron\"",
    "build": "npm run build:svelte && npm run build:electron",
    // Remove "build:shared" script
    "build:svelte": "cd frontend && npm run build",
    "prebuild:electron": "node scripts/cleanup-resources.js",
    "build:electron": "electron-builder",
    // Other scripts...
  }
}
```

### Step 1.3: Update Frontend package.json

Update `frontend/package.json` to remove the shared package dependency:

```json
{
  "dependencies": {
    // Remove "@codex-md/shared" dependency
  }
}
```

### Step 1.4: Update Electron Build Configuration

Update the electron build configuration in `package.json` to remove shared package references:

```json
{
  "build": {
    "files": [
      "src/electron/**/*",
      "frontend/dist/**/*",
      "backend/src/**/*"
      // Remove "shared/dist/**/*" and "shared/package.json"
    ],
    "asarUnpack": [
      "node_modules/@ffmpeg-installer/**/*",
      "backend/src/**/*"
      // Remove "shared/dist/**/*"
    ]
    // Other build configuration...
  }
}
```

## 2. Test in Development Environment

### Step 2.1: Start Development Server

Start the development server to verify that everything works in development mode:

```bash
npm run dev
```

### Step 2.2: Test URL Conversion

Test URL conversion in development mode:

1. Open the application
2. Enter a URL (e.g., https://www.synapticlabs.ai)
3. Verify that the URL is converted successfully

### Step 2.3: Test Other File Types

Test conversion of other file types in development mode:

1. Upload a PDF file
2. Upload a DOCX file
3. Upload other supported file types
4. Verify that all file types are converted successfully

## 3. Build Production Version

### Step 3.1: Build the Application

Build the application for production:

```bash
npm run build
```

### Step 3.2: Test Production Build

Test the production build:

1. Install the built application
2. Open the application
3. Test URL conversion
4. Test conversion of other file types
5. Verify that all functionality works correctly in production

## 4. Troubleshooting

If issues are encountered during testing, follow these troubleshooting steps:

### Step 4.1: Check Import Paths

Verify that all import paths have been updated correctly:

1. Check for any remaining references to `@codex-md/shared`
2. Ensure that relative paths are correct
3. Check for any typos or errors in the import paths

### Step 4.2: Check Module Compatibility

Verify that the module systems are compatible:

1. Check that frontend utilities use ESM exports
2. Check that electron utilities use CommonJS exports
3. Check that backend utilities use CommonJS exports

### Step 4.3: Check for Missing Functions

Verify that all required functions are available:

1. Check that `getFileHandlingInfo` is available in all components
2. Check that other critical functions are available
3. Check for any missing constants or utilities

## 5. Documentation

### Step 5.1: Update Documentation

Update documentation to reflect the new utility structure:

1. Update README.md files
2. Update developer documentation
3. Update any references to the shared package

### Step 5.2: Create Migration Guide

Create a migration guide for developers:

1. Document the new utility structure
2. Provide examples of how to import utilities
3. Explain the rationale for the restructuring

## 6. Clean Up

### Step 6.1: Remove Shared Package (Optional)

If the restructuring is successful and the shared package is no longer needed, consider removing it:

```bash
rm -rf shared
```

### Step 6.2: Update .gitignore

Update `.gitignore` to reflect the new structure:

```
# Remove shared package build artifacts
# shared/dist/
# shared/*.tgz
```

## Conclusion

After completing all steps in this phase, the project should be fully restructured with the shared package utilities moved directly into the frontend, electron, and backend components. The application should work correctly in both development and production environments, with all functionality preserved.