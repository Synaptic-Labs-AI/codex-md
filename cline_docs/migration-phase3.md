# Phase 3: Update Electron Integration

## Goal/Purpose
The purpose of this phase is to update the Electron integration to work with the plain Svelte setup. This involves modifying the Electron main process to properly handle asset loading and IPC communication with the refactored frontend.

## Files to Edit

### Key Files to Modify
- `src/electron/main.js` → Update protocol handlers and path resolution
- `src/electron/preload.js` → Ensure compatibility with new structure
- `scripts/copy-static-assets.js` → Update for new build output structure
- `scripts/afterPack.js` → Update for new build output structure

## Step-by-Step Instructions

### 1. Update Protocol Handler in main.js

The most critical part is updating the file protocol handler to correctly resolve paths for the new Svelte build output structure.

**Edit `src/electron/main.js`**

```javascript
// Enhanced file protocol handler with proper ASAR-aware path resolution
protocol.registerFileProtocol('file', (request, callback) => {
  try {
    let filePath = request.url.replace('file://', '');
    console.log('File protocol request:', filePath);
    
    // Special handling for Windows absolute paths with drive letters
    if (process.platform === 'win32' && filePath.match(/^\/[A-Za-z]:\//)) {
      // Remove the leading slash before the drive letter
      filePath = filePath.replace(/^\/([A-Za-z]:\/.*?)$/, '$1');
      console.log('Normalized Windows path:', filePath);
    }
    
    // Handle static assets from frontend/static
    if (filePath.includes('/static/') || filePath.includes('\\static\\')) {
      const staticFile = path.basename(filePath);
      const staticPath = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../frontend/static', staticFile)
        : path.join(app.getAppPath(), 'frontend/static', staticFile);
          
      const safePath = PathUtils.normalizePath(decodeURI(staticPath));
      console.log('Serving static asset from:', safePath);
      callback(safePath);
      return;
    }
    
    // Handle Vite/Svelte assets (simplified from SvelteKit handling)
    if (filePath.includes('/assets/') || filePath.includes('\\assets\\')) {
      const assetFile = filePath.substring(filePath.lastIndexOf('/') + 1);
      const assetPath = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../frontend/dist/assets', assetFile)
        : path.join(app.getAppPath(), 'frontend/dist/assets', assetFile);
          
      const safePath = PathUtils.normalizePath(decodeURI(assetPath));
      console.log('Serving Vite asset from:', safePath);
      callback(safePath);
      return;
    }
    
    // Special case for index.html
    if (filePath.endsWith('index.html') || filePath.endsWith('\\index.html')) {
      const indexPath = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../frontend/dist/index.html')
        : path.join(app.getAppPath(), 'frontend/dist/index.html');
          
      const safePath = PathUtils.normalizePath(decodeURI(indexPath));
      console.log('Serving index.html from:', safePath);
      callback(safePath);
      return;
    }
    
    // Special case for direct file requests with no path (just a filename)
    if (!filePath.includes('/') && !filePath.includes('\\') && filePath.includes('.')) {
      console.log('Detected direct file request with no path');
      
      // Try to find the file in the dist directory
      const distPath = process.env.NODE_ENV === 'development'
        ? path.join(__dirname, '../frontend/dist', filePath)
        : path.join(app.getAppPath(), 'frontend/dist', filePath);
          
      const safePath = PathUtils.normalizePath(decodeURI(distPath));
      console.log('Serving direct file from dist:', safePath);
      callback(safePath);
      return;
    }
    
    // Handle other file:// requests normally
    const safePath = PathUtils.normalizePath(decodeURI(filePath));
    console.log('Serving standard file from:', safePath);
    callback(safePath);
  } catch (error) {
    console.error('Error in file protocol handler:', error);
    callback({ error: -2 }); // Failed to load
  }
});
```

### 2. Update Window Loading in main.js

Update how the main window loads the application:

```javascript
// Load the app
if (process.env.NODE_ENV === 'development') {
  // Dev mode - load from dev server
  mainWindow.loadURL('http://localhost:5173');
  mainWindow.webContents.openDevTools();
} else {
  // Production - load local files using platform-safe paths
  const appPath = PathUtils.normalizePath(
    process.env.NODE_ENV === 'development'
      ? path.join(__dirname, '../frontend/dist/index.html')
      : path.join(app.getAppPath(), 'frontend/dist/index.html')
  );
  
  // Enable dev tools in production for debugging if needed
  mainWindow.webContents.openDevTools();
  
  // Log the path being loaded
  console.log('Loading app from path:', appPath);
  
  // Use file:// protocol for loading the main HTML file
  mainWindow.loadURL(
    url.format({
      pathname: appPath,
      protocol: 'file:',
      slashes: true
    })
  );
  
  // Log any page load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load app:', errorCode, errorDescription);
    
    // Attempt to reload with a slight delay as a fallback
    if (errorCode !== -3) { // Ignore aborted loads
      console.log('Attempting fallback load after delay...');
      setTimeout(() => {
        mainWindow.loadURL(
          url.format({
            pathname: appPath,
            protocol: 'file:',
            slashes: true
          })
        );
      }, 1000);
    }
  });
}
```

### 3. Update copy-static-assets.js Script

Update the script to handle the new build output structure:

**Edit `scripts/copy-static-assets.js`**

```javascript
async function copyStaticAssets() {
  // Determine if we're running from the root or frontend directory
  const isRunningFromRoot = __dirname.includes('scripts');
  
  const staticDir = isRunningFromRoot 
    ? path.join(__dirname, '../frontend/static')
    : path.join(__dirname, '../static');
    
  const distDir = isRunningFromRoot
    ? path.join(__dirname, '../frontend/dist')
    : path.join(__dirname, '../dist');
  
  console.log('Copying static assets from', staticDir, 'to', distDir);
  
  try {
    // Ensure the dist directory exists
    await fs.ensureDir(distDir);
    
    // Create a static directory in dist for better organization
    const distStaticDir = path.join(distDir, 'static');
    await fs.ensureDir(distStaticDir);
    
    // Get list of files in static directory
    const files = await fs.readdir(staticDir);
    
    // Copy each file to the dist/static directory
    for (const file of files) {
      const srcPath = path.join(staticDir, file);
      const destPath = path.join(distStaticDir, file);
      
      // Check if it's a file (not a directory)
      const stats = await fs.stat(srcPath);
      if (stats.isFile()) {
        try {
          await copyWithRetry(srcPath, destPath);
        } catch (error) {
          console.warn(`⚠️ Could not copy ${file}, will continue with other files`);
          // Continue with other files instead of exiting
        }
      }
    }
    
    console.log('✅ All static assets copied successfully');
  } catch (error) {
    console.error('❌ Error copying static assets:', error);
    process.exit(1);
  }
}
```

### 4. Update afterPack.js Script

Update the script to verify assets in the new structure:

**Edit `scripts/afterPack.js`**

```javascript
// Verify critical static assets
const staticAssets = [
  'favicon-icon.png',
  'app-icon.png',
  'logo.png',
  'synaptic-labs-logo.png'
];

// First check if the static directory exists in the packaged app
const staticDir = path.join(appOutDir, 'frontend', 'static');
const distStaticDir = path.join(appOutDir, 'frontend', 'dist', 'static');

// Ensure the dist/static directory exists
await fs.ensureDir(distStaticDir);

// Check if the static directory exists in the packaged app
const hasStaticDir = await fs.pathExists(staticDir);

if (hasStaticDir) {
  console.log('✅ Static directory found in packaged app');
  
  // Check static assets in both possible locations
  for (const asset of staticAssets) {
    // Check in frontend/static (original location)
    const staticPath = path.join(staticDir, asset);
    const hasStaticAsset = await fs.pathExists(staticPath);
    
    // Check in frontend/dist/static (where they should be copied)
    const distPath = path.join(distStaticDir, asset);
    const hasDistAsset = await fs.pathExists(distPath);
    
    if (hasStaticAsset) {
      console.log(`✅ Verified static asset: ${asset}`);
      
      // If asset exists in static but not in dist/static, copy it
      if (!hasDistAsset) {
        console.log(`Copying ${asset} to dist/static directory...`);
        await fs.copy(staticPath, distPath);
      }
    } else if (hasDistAsset) {
      console.log(`✅ Verified dist/static asset: ${asset}`);
    } else {
      console.warn(`⚠️ Asset not found in packaged app: ${asset}`);
      
      // Try to copy from the project's static directory
      const projectStaticPath = path.join(process.cwd(), 'frontend', 'static', asset);
      if (await fs.pathExists(projectStaticPath)) {
        console.log(`Found ${asset} in project static directory, copying to packaged app...`);
        await fs.copy(projectStaticPath, distPath);
        console.log(`✅ Copied ${asset} to dist/static directory`);
      } else {
        console.error(`❌ Could not find ${asset} in any location`);
      }
    }
  }
}
```

### 5. Update package.json Build Configuration

Ensure the build configuration includes the new structure:

**Edit `package.json` build section**

```json
"build": {
  "files": [
    "src/electron/**/*",
    "frontend/dist/**/*",
    "frontend/static/**/*",
    "backend/dist/**/*",
    "shared/**/*",
    "node_modules/@codex-md/shared/**/*",
    "package.json"
  ],
  "extraResources": [
    {
      "from": "frontend/static",
      "to": "frontend/static"
    }
  ]
}
```

### 6. Test Electron Integration

After making these changes, test the Electron integration:

1. Run the development build:
   ```bash
   npm run dev
   ```

2. Build the production version:
   ```bash
   npm run build
   ```

3. Test the packaged application to ensure:
   - Static assets load correctly
   - Navigation works properly
   - IPC communication functions as expected

### 7. Troubleshooting Common Issues

If you encounter issues with asset loading:

1. **Check console logs** for file path resolution errors
2. **Verify file paths** in the protocol handler
3. **Inspect the packaged app** to ensure files are in the expected locations
4. **Add more detailed logging** to track file requests and resolutions

For IPC communication issues:

1. **Verify preload script** is correctly exposing APIs
2. **Check IPC channel names** match between main and renderer processes
3. **Test IPC calls** with simple examples before integrating complex functionality
