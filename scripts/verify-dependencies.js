/**
 * verify-dependencies.js
 * 
 * This script analyzes the codebase to identify potentially misplaced dependencies.
 * It scans all JavaScript files in the project for require/import statements
 * and checks if they're properly listed in the dependencies section of package.json.
 * 
 * Usage:
 *   node scripts/verify-dependencies.js
 * 
 * Add to package.json scripts:
 *   "verify-deps": "node scripts/verify-dependencies.js"
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

// Node.js built-in modules that should be ignored
const builtinModules = [
  'fs', 'path', 'http', 'https', 'events', 'stream', 'stream/promises', 'crypto', 'url', 'util',
  'os', 'child_process', 'readline', 'zlib', 'buffer', 'assert', 'net',
  'dns', 'querystring', 'tls', 'http2', 'module', 'v8', 'console', 'process',
  'timers', 'async_hooks', 'constants', 'fs/promises', 'perf_hooks', 'worker_threads',
  'string_decoder', 'punycode', 'tty', 'dgram', 'cluster', 'inspector', 'trace_events',
  'vm', 'domain', 'repl', 'electron', 'node:buffer', 'node:stream', 'node:fs',
  'node:path', 'node:os', 'node:http', 'node:https', 'node:zlib', 'node:crypto',
  'node:util', 'node:events', 'node:child_process', 'node:worker_threads', 'node:url'
];

// Electron-specific modules
const electronModules = [
  'electron', 'app', 'Menu', 'MenuItem', 'Tray', 'dialog', 'shell', 'Notification',
  'BrowserWindow', 'ipcMain', 'ipcRenderer', 'contextBridge', 'protocol', 'nativeImage',
  'autoUpdater', 'net', 'clipboard', 'screen', 'webContents', 'webFrame'
];

// Local paths to ignore
const ignorePaths = [
  'node_modules',
  'dist',
  'build',
  'test',
  'coverage',
  '.git',
  '.github',
  '.vscode'
];

// Alias patterns to ignore (these are configured in build tools, not actual packages)
const aliasPatterns = [
  /^@lib\//,
  /^@components\//,
  /^@pages\//,
  /^@assets\//,
  /^@utils\//,
  /^@stores\//,
  /^@api\//
];

// Regex patterns to extract module imports/requires
const importRegexes = [
  /import\s+.*\s+from\s+['"]([^'"./][^'"]*)['"]/g,  // import x from 'module'
  /import\s+['"]([^'"./][^'"]*)['"]/g,               // import 'module'
  /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g    // require('module')
];

// Load package.json files and extract dependencies
const rootPackageJsonPath = path.join(__dirname, '..', 'package.json');
const frontendPackageJsonPath = path.join(__dirname, '..', 'frontend', 'package.json');

const rootPackageJson = require(rootPackageJsonPath);
const rootDependencies = Object.keys(rootPackageJson.dependencies || {});
const rootDevDependencies = Object.keys(rootPackageJson.devDependencies || {});

let frontendDependencies = [];
let frontendDevDependencies = [];

try {
  const frontendPackageJson = require(frontendPackageJsonPath);
  frontendDependencies = Object.keys(frontendPackageJson.dependencies || {});
  frontendDevDependencies = Object.keys(frontendPackageJson.devDependencies || {});
  console.log(`Found frontend package.json with ${frontendDependencies.length} dependencies and ${frontendDevDependencies.length} devDependencies`);
} catch (error) {
  console.warn('Could not load frontend package.json:', error.message);
}

// Combine dependencies from both package.json files
const dependencies = [...rootDependencies, ...frontendDependencies];
const devDependencies = [...rootDevDependencies, ...frontendDevDependencies];

// Files to scan
const srcPaths = [
  path.join(__dirname, '..', 'src'),
  path.join(__dirname, '..', 'frontend', 'src')
];

// Track findings
const missingDependencies = new Set();
const shouldNotBeDevDependencies = new Set();
const modulesUsedInMainProcess = new Set();
const modulesUsedInRendererProcess = new Set();

/**
 * Scan a directory recursively for JS files
 */
async function scanDirectory(dirPath) {
  const files = [];
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    // Skip ignored paths
    if (ignorePaths.some(ignorePath => fullPath.includes(ignorePath))) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await scanDirectory(fullPath);
      files.push(...subFiles);
    } else if (
      entry.isFile() && 
      (fullPath.endsWith('.js') || fullPath.endsWith('.ts') || 
       fullPath.endsWith('.jsx') || fullPath.endsWith('.tsx') ||
       fullPath.endsWith('.mjs') || fullPath.endsWith('.cjs'))
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract required modules from a file
 */
async function extractRequiredModules(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const modules = new Set();
    
    // Use regex to find imports and requires
    for (const regex of importRegexes) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        // Extract the module name (handle scoped packages)
        const fullModuleName = match[1];
        
        // Skip electron, builtin modules, and alias patterns
        if (
          builtinModules.includes(fullModuleName) || 
          electronModules.includes(fullModuleName) ||
          aliasPatterns.some(pattern => pattern.test(fullModuleName))
        ) {
          continue;
        }

        // Handle scoped packages correctly (@org/package)
        let moduleName = fullModuleName;
        if (moduleName.startsWith('@')) {
          moduleName = moduleName.split('/').slice(0, 2).join('/');
        } else {
          moduleName = moduleName.split('/')[0];
        }
        
        modules.add(moduleName);

        // Track if module is used in main or renderer process
        if (filePath.includes('src/electron')) {
          modulesUsedInMainProcess.add(moduleName);
        } else if (filePath.includes('frontend/src')) {
          modulesUsedInRendererProcess.add(moduleName);
        }
      }
    }
    
    return [...modules];
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Scanning for dependencies in source files...');
  
  // Find all JS files
  let allFiles = [];
  for (const srcPath of srcPaths) {
    if (fs.existsSync(srcPath)) {
      const files = await scanDirectory(srcPath);
      allFiles = allFiles.concat(files);
    }
  }
  
  console.log(`Found ${allFiles.length} source files to analyze`);
  
  // Analyze files and extract modules
  const modulesPromises = allFiles.map(file => extractRequiredModules(file));
  const moduleArrays = await Promise.all(modulesPromises);
  
  // Flatten and make unique
  const allModules = [...new Set(moduleArrays.flat())];
  
  console.log(`Found ${allModules.length} unique modules imported`);
  
  // Check if modules are properly listed in dependencies
  for (const module of allModules) {
    // Check if missing completely
    if (!dependencies.includes(module) && !devDependencies.includes(module)) {
      missingDependencies.add(module);
    }
    // Check if in devDependencies but used in runtime code
    else if (!dependencies.includes(module) && devDependencies.includes(module)) {
      shouldNotBeDevDependencies.add(module);
    }
  }
  
  // Output findings
  console.log('\n--- Dependency Check Results ---\n');
  
  if (missingDependencies.size > 0) {
    console.log('\n⚠️ MISSING DEPENDENCIES:');
    console.log('The following modules are imported but not listed in package.json:');
    [...missingDependencies].sort().forEach(module => {
      console.log(`  - ${module}`);
    });
  }
  
  if (shouldNotBeDevDependencies.size > 0) {
    console.log('\n❌ MISPLACED DEPENDENCIES:');
    console.log('The following modules are in devDependencies but appear to be used at runtime:');
    [...shouldNotBeDevDependencies].sort().forEach(module => {
      const locations = [];
      if (modulesUsedInMainProcess.has(module)) locations.push('Main Process');
      if (modulesUsedInRendererProcess.has(module)) locations.push('Renderer Process');
      
      console.log(`  - ${module}${locations.length ? ` (Used in: ${locations.join(', ')})` : ''}`);
    });
    
    // Provide package.json update command
    console.log('\nTo fix, move these dependencies from devDependencies to dependencies:');
    console.log('\n```');
    console.log('npm install --save ' + [...shouldNotBeDevDependencies].join(' '));
    console.log('```');
  }
  
  if (missingDependencies.size === 0 && shouldNotBeDevDependencies.size === 0) {
    console.log('✅ All dependencies appear to be correctly categorized!');
  } else {
    // Exit with error code if issues found
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('Error checking dependencies:', error);
  process.exit(1);
});
