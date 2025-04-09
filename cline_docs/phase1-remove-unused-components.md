# Phase 1: Remove Unused Components

## Overall Goal

Remove unused UI components and related stores to reduce codebase size and complexity. This phase focuses on eliminating components that are no longer needed, such as ProfessorSynapseAd and potentially OcrSettings, along with any associated stores or assets.

## Files to Change/Delete

### Files to Delete:
- `frontend/src/lib/components/ProfessorSynapseAd.svelte`
- `frontend/src/lib/stores/adStore.js` (if it exists)
- `frontend/src/lib/components/settings/OcrSettings.svelte` (if not used)

### Files to Check for References:
- `frontend/src/App.svelte`
- `frontend/src/routes/*.svelte`
- `frontend/src/lib/stores/index.js`
- Any files that might import these components

## Step-by-Step Process

### 1. Verify Component Usage

Before deleting any components, we need to verify they are truly unused:

```bash
# Command to search for imports (for reference)
grep -r "import.*ProfessorSynapseAd" frontend/src/
grep -r "import.*OcrSettings" frontend/src/
```

- Check all import statements in the codebase
- Look for component references in templates (`<ProfessorSynapseAd />`)
- Verify no dynamic imports are used (e.g., `import(./components/${componentName})`)

### 2. Check for adStore

- Determine if `adStore.js` exists in `frontend/src/lib/stores/`
- If it exists, search for its imports throughout the codebase:

```bash
# Command to search for imports (for reference)
grep -r "import.*adStore" frontend/src/
```

- Check if it's exported in `frontend/src/lib/stores/index.js`
- Verify it's not used elsewhere in the application

### 3. Remove ProfessorSynapseAd Component

Once verified as unused:

- Delete `frontend/src/lib/components/ProfessorSynapseAd.svelte`
- Check for any CSS files specifically for this component
- Check for any assets (images, icons) used exclusively by this component
- Remove any component-specific tests if they exist

### 4. Remove adStore (if it exists)

If verified as unused:

- Delete `frontend/src/lib/stores/adStore.js`
- If it's imported in `frontend/src/lib/stores/index.js`, remove the import and export:

```javascript
// Before
import { adStore } from './adStore.js';
export { adStore };

// After
// (imports and exports for adStore removed)
```

- Check for any subscription cleanup in component onDestroy hooks

### 5. Check OcrSettings Component

- Search for imports and references to `OcrSettings` throughout the codebase
- Determine if OCR settings are now handled differently
- If the component is unused:
  - Delete `frontend/src/lib/components/settings/OcrSettings.svelte`
  - Remove any references to it in parent components
  - Check for any associated stores or utilities

### 6. Update Any Remaining References

- If any components imported the deleted components but didn't use them, update those import statements
- Check for any lazy-loaded components that might reference the deleted components
- Update any navigation or routing that might reference these components

### 7. Test Application

- Run the application in development mode
- Verify that all pages load correctly
- Test the OCR functionality to ensure it still works properly
- Check the console for any errors related to missing components
- Verify that no UI elements are missing or broken

### 8. Document Changes

- Update `cline_docs/progress.md` to document the removed components
- Add a note explaining that these components were removed as part of the streamlining effort
- Document how OCR settings are now handled (if OcrSettings was removed)

## Risk Mitigation

- Before permanent deletion, you can temporarily rename the files (e.g., add `.bak` extension) and test the application
- Keep a backup of the original files until testing is complete
- If any issues arise, you can restore the original files and investigate further

## Success Criteria

- Application runs without errors after component removal
- No references to deleted components remain in the codebase
- OCR functionality continues to work properly (if OcrSettings was removed)
- No visual or functional regressions in the UI