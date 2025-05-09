// scripts/ensure-resources-bin.js
/**
 * Ensures the resources/bin directory exists.
 * This is necessary because the extraResources configuration in package.json
 * copies FFmpeg binaries into this directory. Electron Builder might create
 * the directory, but this script guarantees it exists beforehand.
 */

const fs = require('fs-extra');
const path = require('path');

// Define the path relative to the project root
const resourcesBinDir = path.resolve(__dirname, '..', 'resources', 'bin');

async function ensureResourcesBin() {
  try {
    console.log(`Ensuring directory exists: ${resourcesBinDir}`);
    await fs.ensureDir(resourcesBinDir);
    console.log(`✅ Successfully ensured directory exists: ${resourcesBinDir}`);
  } catch (error) {
    console.error(`❌ Failed to ensure directory ${resourcesBinDir}:`, error);
    process.exit(1); // Exit with error code if directory creation fails
  }
}

ensureResourcesBin();