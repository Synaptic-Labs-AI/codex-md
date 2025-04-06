/**
 * Main entry point for @codex-md/shared package
 * 
 * This module provides access to all shared utilities used across
 * frontend, backend, and electron parts of the Codex MD application.
 * 
 * Usage examples:
 * ```javascript
 * // CommonJS
 * const shared = require('@codex-md/shared');
 * const { utils } = require('@codex-md/shared');
 * const { files } = require('@codex-md/shared/utils');
 * 
 * // ES Modules
 * import * as shared from '@codex-md/shared';
 * import { utils } from '@codex-md/shared';
 * import { files } from '@codex-md/shared/utils';
 * ```
 */

const utils = require('./utils');

// Package metadata
const VERSION = '1.0.0';
const PACKAGE_NAME = '@codex-md/shared';

// Export everything
module.exports = {
    ...utils,
    
    // Re-export main utility groups for convenient access
    utils: utils.utils,
    files: utils.files,
    markdown: utils.markdown,
    web: utils.web,
    conversion: utils.conversion,
    
    // Package metadata
    VERSION,
    PACKAGE_NAME
};
