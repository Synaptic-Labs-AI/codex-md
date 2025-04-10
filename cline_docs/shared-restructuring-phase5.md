# Phase 5: Update Import Paths

This document provides detailed step-by-step instructions for updating import paths throughout the codebase as part of the shared package restructuring.

## 1. Identify Files to Update

First, identify all files that import from the shared package:

```bash
# Search for imports from @codex-md/shared
grep -r "from '@codex-md/shared'" --include="*.js" --include="*.svelte" .
grep -r "from \"@codex-md/shared\"" --include="*.js" --include="*.svelte" .
grep -r "require('@codex-md/shared')" --include="*.js" --include="*.cjs" .
grep -r "require(\"@codex-md/shared\")" --include="*.js" --include="*.cjs" .
```

## 2. Update Frontend Import Paths

### Step 2.1: Update FileUploader.svelte

Update `frontend/src/lib/components/FileUploader.svelte`:

```javascript
// Before
import { getFileHandlingInfo } from '@codex-md/shared';

// After
import { getFileHandlingInfo } from '@lib/utils/files/types';
```

### Step 2.2: Update files.js

Update `frontend/src/lib/stores/files.js`:

```javascript
// Before
import { getFileType, getFileHandlingInfo } from '@codex-md/shared';

// After
import { getFileType, getFileHandlingInfo } from '@lib/utils/files/types';
```

### Step 2.3: Update client.js

Update `frontend/src/lib/api/electron/client.js`:

```javascript
// Before
import { getFileHandlingInfo } from '@codex-md/shared';

// After
import { getFileHandlingInfo } from '@lib/utils/files/types';
```

### Step 2.4: Update unifiedConversion.js

Update `frontend/src/lib/stores/unifiedConversion.js`:

```javascript
// Before
import { getFileHandlingInfo } from '@codex-md/shared';

// After
import { getFileHandlingInfo } from '@lib/utils/files/types';
```

### Step 2.5: Update Other Frontend Files

For each additional frontend file that imports from the shared package:

1. Identify the specific imports being used
2. Replace with imports from the appropriate local utility file

## 3. Update Electron Import Paths

### Step 3.1: Update conversion/index.js

Update `src/electron/ipc/handlers/conversion/index.js`:

```javascript
// Before
const { getFileHandlingInfo } = require('@codex-md/shared');

// After
const { getFileHandlingInfo } = require('../../../utils/files/types');
```

### Step 3.2: Update UnifiedConverterFactory.js

Update `src/electron/converters/UnifiedConverterFactory.js`:

```javascript
// Before
const { getFileHandlingInfo } = require('@codex-md/shared');

// After
const { getFileHandlingInfo } = require('../utils/files/types');
```

### Step 3.3: Update ElectronConversionService.js

Update `src/electron/services/ElectronConversionService.js`:

```javascript
// Before
const { getFileHandlingInfo } = require('@codex-md/shared');

// After
const { getFileHandlingInfo } = require('../utils/files/types');
```

### Step 3.4: Update Other Electron Files

For each additional electron file that imports from the shared package:

1. Identify the specific imports being used
2. Replace with imports from the appropriate local utility file
3. Ensure the relative path is correct

## 4. Update Backend Import Paths (if needed)

For each backend file that imports from the shared package:

1. Identify the specific imports being used
2. Replace with imports from the appropriate local utility file
3. Ensure the relative path is correct

Example:

```javascript
// Before
const { getFileHandlingInfo } = require('@codex-md/shared');

// After
const { getFileHandlingInfo } = require('../utils/files/types');
```

## 5. Update Test Files (if applicable)

If there are test files that import from the shared package, update them as well:

1. Identify test files that import from the shared package
2. Replace imports with imports from the appropriate local utility file
3. Ensure the relative path is correct

## 6. Verify Import Paths

After updating all import paths, verify that they are correct:

1. Check for any remaining references to `@codex-md/shared`
2. Ensure that relative paths are correct
3. Check for any typos or errors in the import paths

## Next Steps

Proceed to [Phase 6: Clean Up and Testing](./shared-restructuring-phase6.md) to clean up the project and test the changes.