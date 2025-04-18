# Dependency Management Best Practices

## Overview

This document outlines best practices for managing dependencies in the Codex MD Electron application. Following these guidelines will help prevent common issues such as missing modules in production builds, which can cause application failures.

## Dependencies vs. DevDependencies

In Node.js projects, dependencies are categorized into two main groups:

1. **Dependencies** (`dependencies` in package.json):
   - Required at runtime for the application to function
   - Included in production builds
   - Examples: libraries used by application code, frameworks, runtime utilities

2. **DevDependencies** (`devDependencies` in package.json):
   - Only needed during development, testing, or build processes
   - Not included in production builds
   - Examples: testing frameworks, build tools, linters, type definitions

## Common Pitfalls

### Misplaced Runtime Dependencies

A common issue in Electron applications is placing runtime dependencies in `devDependencies`. This works in development because all dependencies are installed, but fails in production because `devDependencies` are not included in the final package.

Signs of misplaced dependencies:
- Errors like `Cannot find module 'xyz'` in production but not in development
- Application features that work in development but fail in production
- Crashes during specific operations only in production builds

### Recently Encountered Issues

We have encountered and fixed several instances of misplaced dependencies:

1. **node-cache**: Required by OpenAIProxyService for API response caching
2. **axios** and **axios-retry**: Needed for HTTP requests and retry logic
3. **canvas**: Used for PDF rendering in StandardPdfConverter
4. **formdata-node**: Required for form data handling
5. **tmp-promise**: Used for temporary file operations
6. **csv-parse**: Required for CSV file processing

## Dependency Categorization Guidelines

### Should be in `dependencies`:

- Any module imported/required in application code that runs in production
- Libraries used by the main process or renderer process
- Modules needed for file conversion, API communication, etc.
- Electron-specific packages (electron-store, electron-updater, etc.)
- UI frameworks and components
- File system utilities
- Database connectors
- API clients
- Data processing libraries

### Should be in `devDependencies`:

- Testing frameworks (Jest, Mocha, etc.)
- Build tools (webpack, Babel, TypeScript, etc.)
- Development servers
- Linters and formatters (ESLint, Prettier)
- Type definitions (@types/*)
- Documentation generators
- Development convenience utilities
- Tools that are only executed during CI/CD

## Audit Process

To prevent dependency-related issues, perform these checks:

### Before Releasing

1. **Static Analysis**:
   - Scan the codebase for `require` and `import` statements
   - Cross-reference with package.json to ensure all required modules are in `dependencies`

2. **Development vs. Production Testing**:
   - Test the application with only production dependencies installed:
   ```
   npm ci --only=prod
   ```
   - Run the application in production mode to verify functionality

3. **Module Validation**:
   Add checks in critical services to validate required modules:
   ```javascript
   function validateDependencies() {
     const requiredModules = ['axios', 'node-cache', 'canvas'];
     const missing = [];
     
     for (const module of requiredModules) {
       try {
         require.resolve(module);
       } catch (error) {
         missing.push(module);
       }
     }
     
     if (missing.length > 0) {
       console.error(`Missing required modules: ${missing.join(', ')}`);
       // Handle gracefully or exit
     }
   }
   ```

### Automated Checks

Consider implementing automated dependency validation:

1. **Pre-build Check**:
   Create a script that runs before building to verify dependencies:
   ```javascript
   // scripts/verify-dependencies.js
   const fs = require('fs');
   const path = require('path');
   
   // Load package.json
   const packageJson = require('../package.json');
   const dependencies = Object.keys(packageJson.dependencies || {});
   
   // Scan directories for imports/requires
   const sourceFiles = scanDirectory('src');
   const requiredModules = extractRequiredModules(sourceFiles);
   
   // Check for missing dependencies
   const missing = requiredModules.filter(
     module => !dependencies.includes(module) && !isBuiltinModule(module)
   );
   
   if (missing.length > 0) {
     console.error('Missing dependencies in package.json:', missing);
     process.exit(1);
   }
   ```

2. **CI Pipeline Validation**:
   Add a step in the CI pipeline to install only production dependencies and run verification

## Adding New Dependencies

Follow these steps when adding new dependencies:

1. **Evaluate the Dependency**:
   - Is it used in the runtime application? → `dependencies`
   - Is it only for development, testing, or building? → `devDependencies`

2. **Document Your Decision**:
   - Add a comment in the code explaining why the dependency is needed
   - Update relevant documentation

3. **Test in Production Mode**:
   - Verify the dependency works correctly in a production build

## Electron-Specific Considerations

### Native Dependencies

Native dependencies require special attention:
- Must be compiled for the correct Electron version
- May need to be unpacked (not included in asar archive)
- Add to `asarUnpack` in electron-builder configuration

### Node.js Built-in Modules

Node.js comes with a set of built-in modules that don't need to be listed in package.json:

- **Main Process**: Built-in modules like `fs`, `path`, `stream`, `http`, etc. are automatically available
- **Renderer Process**: Built-in modules are NOT available by default due to security restrictions
- **When to Add**: 
  - Never add built-in modules to package.json for the main process
  - For renderer process, add browser-compatible alternatives (e.g., `stream-browserify` instead of `stream`)

Common built-in modules:
```
fs, path, http, https, stream, crypto, url, util, os, 
child_process, readline, zlib, buffer, assert, net, 
querystring, tls, events, process, timers
```

### Node.js vs. Electron API Compatibility

Be aware of compatibility issues between Node.js and Electron APIs:
- Some Node.js modules may not work correctly in the renderer process
- Use IPC to communicate between renderer and main process for such operations
- For renderer process, consider using the contextBridge to expose only the necessary functionality

## Monorepo/Workspace Considerations

This project uses a workspace structure with separate package.json files:

1. **Root package.json**:
   - Contains dependencies for the Electron main process
   - Includes build scripts and configuration
   - Manages the overall project

2. **frontend/package.json**:
   - Contains dependencies specific to the frontend (Svelte application)
   - Manages the frontend build process
   - Includes frontend-specific tools and libraries

### Dependency Placement Guidelines

When adding a new dependency, consider where it will be used:

1. **Main Process Only**:
   - Add to the root package.json `dependencies` section
   - Example: `electron-store`, `fs-extra`

2. **Renderer Process Only**:
   - Add to frontend/package.json `dependencies` section
   - Example: `svelte`, `svelte-hero-icons`

3. **Shared Between Both**:
   - Add to both package.json files
   - Example: API clients, utility libraries

4. **Build/Development Tools**:
   - Add to the appropriate package.json `devDependencies` section
   - Example: `vite` in frontend, `electron-builder` in root

### Common Pitfalls in Workspace Projects

1. **Missing Frontend Dependencies**:
   - Frontend dependencies must be in frontend/package.json
   - The verification script may report missing dependencies that are actually in the frontend package.json

2. **Duplicate Dependencies**:
   - Having the same dependency in both package.json files can lead to version conflicts
   - Consider hoisting common dependencies to the root when possible

3. **Alias Resolution**:
   - Aliases like `@lib/api` are configured in the build system (Vite)
   - These are not actual dependencies and don't need to be in package.json

## Conclusion

Properly managing dependencies is critical for a reliable application. By following these guidelines, we can prevent common issues and ensure our application works correctly in both development and production environments.

## References

- [Electron Documentation](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [npm Documentation](https://docs.npmjs.com/specifying-dependencies-and-devdependencies-in-a-package-json-file)
- [electron-builder Documentation](https://www.electron.build/configuration/configuration)
- [npm Workspaces](https://docs.npmjs.com/cli/v7/using-npm/workspaces)
