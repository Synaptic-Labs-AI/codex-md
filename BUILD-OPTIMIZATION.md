# Build Optimization Guide

This document explains the optimizations implemented to resolve the NSIS memory mapping error and icon format issues during the Windows installer build process.

## Problems

### Memory Mapping Error

The original build process encountered the following error:

```
Internal compiler error #12345: error creating mmap the size of 669492111.
```

This error occurs when NSIS (Nullsoft Scriptable Install System) tries to allocate too much memory (~670MB) during the installer creation process. This is typically caused by including too many files or large files in the installer package.

### Icon Format Error

After fixing the memory mapping error, we encountered another issue with the icon format:

```
Error while loading icon from "C:\Users\Joseph\Documents\Code\codex-md\frontend\static\app-icon.png": invalid icon file
```

NSIS requires ICO format for icons, but we were using PNG files.

## Solutions

### Memory Mapping Fix

We've implemented several optimizations to reduce the memory usage during the build process:

1. **Optimized node_modules packaging**:
   - Removed the entire node_modules directory from extraFiles
   - Only included necessary dependencies in the asar package
   - Excluded test, documentation, and example files

2. **NSIS Configuration**:
   - Added custom NSIS configuration to better handle memory usage
   - Changed from one-click installer to custom installer with more options
   - Explicitly specified architecture (x64)

3. **Build Process Optimization**:
   - Added a new `optimize-build.js` script to clean up unnecessary files before packaging
   - Updated build scripts to include the optimization step

### Icon Format Fix

To fix the icon format issue:

1. **Icon Conversion**:
   - Created a new `convert-icons.js` script to convert PNG icons to ICO format
   - Added the script to the build process
   - Updated all icon references in package.json to use the ICO files

2. **Icon Storage**:
   - Created a dedicated `build/icons` directory for storing converted icons
   - Ensured proper icon paths in the NSIS configuration

## How to Build

To build the application with these optimizations:

```bash
# Install dependencies
npm install

# Build the frontend
npm run build:frontend

# Build the electron app with optimizations
npm run build:electron
```

Or use the combined build command:

```bash
npm run build
```

For debugging the build process with detailed logs:

```bash
npm run debug:log
```

## Optimization Details

### Package.json Changes

1. **Modified asarUnpack configuration**:
   - Only unpacking specific modules that need direct file access
   - Keeping most modules in the asar archive

2. **Updated files configuration**:
   - Added exclusion patterns for test, documentation, and example files
   - Reduced the overall package size

3. **Removed node_modules from extraFiles**:
   - Only including ffmpeg.exe as an extraFile
   - Significantly reducing the installer size

4. **Icon Configuration**:
   - Updated all icon paths to use ICO format
   - Added icon conversion to the build process

### NSIS Configuration

Added custom NSIS configuration:

```json
"nsis": {
  "oneClick": false,
  "allowElevation": true,
  "allowToChangeInstallationDirectory": true,
  "createDesktopShortcut": true,
  "createStartMenuShortcut": true,
  "shortcutName": "codex.md",
  "installerIcon": "build/icons/icon.ico",
  "uninstallerIcon": "build/icons/icon.ico",
  "installerHeaderIcon": "build/icons/icon.ico",
  "deleteAppDataOnUninstall": true
}
```

### Optimization Scripts

#### optimize-build.js

Created a new `optimize-build.js` script that:

1. Removes test directories from node_modules
2. Removes documentation and example files
3. Cleans up other non-essential files
4. Optionally removes source maps to further reduce size

#### convert-icons.js

Created a new `convert-icons.js` script that:

1. Converts PNG icons to ICO format using png-to-ico
2. Creates the build/icons directory if it doesn't exist
3. Verifies the conversion was successful

## Troubleshooting

If you still encounter memory issues during the build:

1. **Increase available memory**:
   - Close other applications to free up system memory
   - Consider adding more RAM if possible

2. **Further reduce package size**:
   - Uncomment the source map removal in `optimize-build.js`
   - Add more exclusion patterns in the `files` section of package.json

3. **Use alternative packaging**:
   - Try using ZIP packaging instead of NSIS by changing the target in package.json:
     ```json
     "win": {
       "target": [
         {
           "target": "zip",
           "arch": ["x64"]
         }
       ]
     }
     ```

## Additional Resources

- [Electron Builder Documentation](https://www.electron.build/)
- [NSIS Documentation](https://nsis.sourceforge.io/Docs/)
- [Electron Packaging Best Practices](https://www.electronjs.org/docs/latest/tutorial/application-packaging)
