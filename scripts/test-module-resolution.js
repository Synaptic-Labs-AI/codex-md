/**
 * test-module-resolution.js
 * Tests the ModuleResolver to verify it can find modules correctly.
 */

// Set up mock environment similar to electron
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Required modules
const path = require('path');
const fs = require('fs-extra');

// Simulate electron.app
const mockApp = {
  isPackaged: true,
  getAppPath: () => process.cwd(),
  getName: () => 'Codex.md',
  getVersion: () => '1.0.0',
  getPath: (type) => {
    if (type === 'userData') return path.join(process.cwd(), 'userData');
    return process.cwd();
  }
};

// Mock electron module
const electronMock = {
  app: mockApp
};

// Inject mock into require cache
require.cache[require.resolve('electron')] = {
  exports: electronMock
};

console.log('🔧 Testing module resolution with ModuleResolver');

// Import the ModuleResolver
const { ModuleResolver } = require('../src/electron/utils/moduleResolver');

// Function to test module resolution
async function testModuleResolution() {
  // Create list of critical modules to test
  const modules = [
    { name: 'ConverterRegistry.js', category: 'services/conversion' },
    { name: 'ElectronConversionService.js', category: 'services' },
    { name: 'UnifiedConverterFactory.js', category: 'converters' }
  ];
  
  // Track results
  const results = [];
  
  // Test each module
  for (const module of modules) {
    console.log(`\n📋 Testing resolution for: ${module.name} in ${module.category}`);
    
    try {
      // Get all possible paths
      const allPaths = ModuleResolver.getAllPaths(module.name, module.category);
      console.log(`🔍 Found ${allPaths.length} possible paths:`);
      
      // Check each path
      let foundPath = null;
      for (const p of allPaths) {
        try {
          const exists = fs.existsSync(p);
          console.log(`  - ${p}: ${exists ? '✅ EXISTS' : '❌ missing'}`);
          if (exists && !foundPath) foundPath = p;
        } catch (e) {
          console.log(`  - ${p}: ❌ error: ${e.message}`);
        }
      }
      
      // Try to load the module
      if (foundPath) {
        console.log(`🔄 Attempting to load from: ${foundPath}`);
        
        try {
          const resolvedModule = ModuleResolver.safeRequire(module.name, module.category);
          console.log(`✅ Successfully loaded ${module.name}`);
          
          // Check module structure
          console.log(`📊 Module structure:`);
          if (typeof resolvedModule === 'object') {
            console.log(`  - Keys: ${Object.keys(resolvedModule).join(', ')}`);
            
            // Check specifically for ConverterRegistry
            if (module.name === 'ConverterRegistry.js') {
              console.log(`  - Has converters: ${!!resolvedModule.converters}`);
              if (resolvedModule.converters) {
                console.log(`  - Available converters: ${Object.keys(resolvedModule.converters).join(', ')}`);
              }
            }
          } else {
            console.log(`  - Type: ${typeof resolvedModule}`);
          }
          
          results.push({ module: module.name, success: true, path: foundPath });
        } catch (loadError) {
          console.log(`❌ Failed to load module: ${loadError.message}`);
          results.push({ module: module.name, success: false, error: loadError.message });
        }
      } else {
        console.log(`❌ No existing path found for ${module.name}`);
        results.push({ module: module.name, success: false, error: 'No existing path found' });
      }
    } catch (error) {
      console.error(`❌ Error testing ${module.name}: ${error.message}`);
      results.push({ module: module.name, success: false, error: error.message });
    }
  }
  
  // Print summary
  console.log('\n📈 Test Results Summary:');
  let allSuccess = true;
  
  for (const result of results) {
    if (result.success) {
      console.log(`✅ ${result.module}: Successfully loaded from ${result.path}`);
    } else {
      console.log(`❌ ${result.module}: Failed - ${result.error}`);
      allSuccess = false;
    }
  }
  
  if (allSuccess) {
    console.log('\n🎉 All modules successfully resolved!');
    return 0;
  } else {
    console.log('\n⚠️ Some modules failed to resolve. Check logs for details.');
    return 1;
  }
}

// Run the test
testModuleResolution()
  .then(exitCode => {
    console.log('Test completed.');
    process.exit(exitCode);
  })
  .catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });