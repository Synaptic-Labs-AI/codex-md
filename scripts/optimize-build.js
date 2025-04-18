/**
 * optimize-build.js
 * 
 * This script optimizes the build process by cleaning up unnecessary files
 * before packaging and helps reduce memory usage during NSIS installer creation.
 * 
 * It removes:
 * - Test files and directories
 * - Documentation
 * - Example code
 * - Source maps (optional)
 * - Other non-essential files that increase package size
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

// Directories to clean up
const CLEANUP_PATTERNS = [
  // Test directories
  'node_modules/**/test',
  'node_modules/**/tests',
  // Documentation
  'node_modules/**/docs',
  'node_modules/**/doc',
  'node_modules/**/documentation',
  // Examples
  'node_modules/**/example',
  'node_modules/**/examples',
  // Demo files
  'node_modules/**/demo',
  // Source maps (optional - uncomment if you want to remove these)
  // 'node_modules/**/*.map',
  // Git directories
  'node_modules/**/.git',
  // TypeScript source files (compiled JS is kept)
  'node_modules/**/*.ts',
  '!node_modules/**/*.d.ts',
  // Markdown files
  'node_modules/**/*.md',
  // CI config files
  'node_modules/**/.travis.yml',
  'node_modules/**/.github',
  // Development config files
  'node_modules/**/tsconfig.json',
  'node_modules/**/webpack.config.js',
  'node_modules/**/rollup.config.js',
  'node_modules/**/gulpfile.js',
  'node_modules/**/Gruntfile.js',
];

/**
 * Cleans up unnecessary files to reduce package size
 */
async function cleanupNodeModules() {
  console.log('🧹 Cleaning up node_modules to reduce package size...');
  
  try {
    // Use rimraf for faster deletion
    for (const pattern of CLEANUP_PATTERNS) {
      try {
        // Use glob pattern with rimraf
        execSync(`npx rimraf "${pattern}"`, { stdio: 'ignore' });
      } catch (err) {
        console.warn(`⚠️ Error cleaning up pattern ${pattern}:`, err.message);
      }
    }
    
    console.log('✅ Cleanup completed successfully');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

/**
 * Optimizes the dist directory before packaging
 */
async function optimizeDistDirectory() {
  console.log('🔍 Optimizing dist directory...');
  
  try {
    const distPath = path.join(process.cwd(), 'frontend', 'dist');
    
    // Check if dist directory exists
    if (!await fs.pathExists(distPath)) {
      console.warn('⚠️ Dist directory not found, skipping optimization');
      return;
    }
    
    // Remove source maps if they exist (optional)
    const mapFiles = await fs.glob('**/*.map', { cwd: distPath });
    if (mapFiles.length > 0) {
      console.log(`Found ${mapFiles.length} source map files to remove`);
      for (const file of mapFiles) {
        await fs.remove(path.join(distPath, file));
      }
    }
    
    console.log('✅ Dist directory optimization completed');
  } catch (error) {
    console.error('❌ Error optimizing dist directory:', error);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting build optimization...');
  
  // Ensure rimraf is installed
  try {
    execSync('npx rimraf --version', { stdio: 'ignore' });
  } catch (error) {
    console.log('📦 Installing rimraf for faster cleanup...');
    execSync('npm install rimraf --no-save', { stdio: 'inherit' });
  }
  
  // Run optimizations
  await cleanupNodeModules();
  await optimizeDistDirectory();
  
  console.log('✨ Build optimization completed successfully');
}

// Run the script
main().catch(err => {
  console.error('❌ Fatal error during optimization:', err);
  process.exit(1);
});
