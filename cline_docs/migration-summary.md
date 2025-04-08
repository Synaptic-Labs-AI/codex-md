# SvelteKit to Plain Svelte + Vite Migration Plan

## Overview

This document provides a comprehensive plan for migrating the Codex MD application from SvelteKit to plain Svelte + Vite. The migration is designed to address the asset loading issues in Electron by simplifying the frontend architecture while maintaining all existing functionality.

## Why Migrate?

SvelteKit is an excellent framework for web applications, but it introduces complexity that can cause issues in Electron applications:

1. **Path Resolution Conflicts**: SvelteKit's server-side routing and path handling can conflict with Electron's file:// protocol
2. **Asset Loading Issues**: The way SvelteKit generates asset paths can cause loading failures in packaged Electron apps
3. **Unnecessary Complexity**: Many SvelteKit features (SSR, API routes, etc.) are not needed in Electron apps
4. **Build Output Structure**: SvelteKit's build output is optimized for web deployment, not Electron packaging

By migrating to plain Svelte + Vite, we can:

1. **Simplify Asset Loading**: Use relative paths that work reliably with Electron's file:// protocol
2. **Reduce Complexity**: Remove unnecessary server-side code and middleware
3. **Optimize for Electron**: Tailor the build process specifically for Electron
4. **Improve Maintainability**: Create a more straightforward codebase that's easier to maintain

## Migration Phases

The migration is divided into five phases, each focusing on a specific aspect of the transition:

### [Phase 1: Convert SvelteKit to Plain Svelte + Vite](migration-phase1.md)

This phase focuses on setting up the basic structure for the plain Svelte + Vite application by modifying the existing SvelteKit configuration and creating the necessary entry points.

Key tasks:
- Update dependencies in package.json
- Create HTML entry point
- Update Vite configuration
- Create main entry point and App component
- Set up client-side routing

### [Phase 2: Refactor Core Components and Stores](migration-phase2.md)

This phase involves refactoring the existing components and stores to work with plain Svelte instead of SvelteKit, focusing on maintaining functionality while removing SvelteKit-specific code.

Key tasks:
- Identify SvelteKit-specific code
- Create routes configuration
- Transform layout to App component
- Refactor page components
- Update components with SvelteKit dependencies
- Refactor API calls
- Update store implementations

### [Phase 3: Update Electron Integration](migration-phase3.md)

This phase updates the Electron integration to work with the plain Svelte setup, focusing on protocol handlers and path resolution to ensure assets load correctly in the packaged application.

Key tasks:
- Update protocol handler in main.js
- Update window loading
- Update copy-static-assets.js script
- Update afterPack.js script
- Update package.json build configuration

### [Phase 4: Testing and Validation](migration-phase4.md)

This phase involves thoroughly testing the migrated application to ensure all functionality works correctly with the new plain Svelte + Vite setup.

Key tasks:
- Test in development mode
- Test production build
- Validate asset loading
- Test navigation
- Verify IPC communication
- Test Electron features
- Perform regression testing
- Check performance

### [Phase 5: Optimization and Cleanup](migration-phase5.md)

This final phase focuses on optimizing the migrated application and cleaning up any remaining artifacts from the SvelteKit to plain Svelte migration.

Key tasks:
- Optimize performance
- Clean up code
- Update documentation
- Optimize build process
- Future-proof the application
- Perform final cleanup

## Implementation Strategy

The migration will follow an incremental approach:

1. **Preserve Existing Functionality**: Maintain all current features and user experience
2. **Minimize Code Changes**: Focus on structural changes rather than rewriting components
3. **Test Continuously**: Validate each step before proceeding to the next
4. **Document Changes**: Keep detailed documentation of all changes for future reference

## Expected Benefits

After completing the migration, we expect to see:

1. **Improved Reliability**: More reliable asset loading in the packaged application
2. **Simplified Codebase**: Easier to understand and maintain
3. **Better Performance**: Potentially faster startup and navigation
4. **Reduced Bundle Size**: Smaller application size without SvelteKit overhead
5. **Easier Debugging**: Simpler architecture makes issues easier to diagnose and fix

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Functionality regression | Comprehensive testing after each phase |
| Performance issues | Performance testing and optimization in Phase 5 |
| Unexpected compatibility issues | Incremental approach with validation at each step |
| Extended timeline | Clear phase boundaries allow for partial implementation |

## Conclusion

This migration plan provides a structured approach to transitioning from SvelteKit to plain Svelte + Vite while maintaining all existing functionality. By following this plan, we can address the asset loading issues in Electron and create a more maintainable and reliable application.

The modular nature of the plan allows for incremental implementation, with each phase building on the previous one. This approach minimizes risk and allows for validation at each step.

Upon completion, the Codex MD application will have a simpler, more reliable architecture that is better suited for Electron, while maintaining all the benefits of Svelte for the user interface.
