/**
 * Main entry point for @codex-md/shared package (ES Module version)
 * 
 * This module provides access to all shared utilities used across
 * frontend, backend, and electron parts of the Codex MD application.
 * 
 * Usage examples:
 * ```javascript
 * // ES Modules
 * import * as shared from '@codex-md/shared';
 * import { utils } from '@codex-md/shared';
 * import { files } from '@codex-md/shared/utils';
 * 
 * // CommonJS (after build)
 * const shared = require('@codex-md/shared');
 * const { utils } = require('@codex-md/shared');
 * const { files } = require('@codex-md/shared/utils');
 * ```
 */

import * as utils from './utils/index.js';

// Package metadata
export const VERSION = '1.0.0';
export const PACKAGE_NAME = '@codex-md/shared';

// Re-export main utility groups for convenient access
export { utils };
export const files = utils.files;
export const markdown = utils.markdown;
export const web = utils.web;
export const conversion = utils.conversion;

// Default export for compatibility
export default {
    ...utils,
    
    // Re-export main utility groups for convenient access
    utils,
    files,
    markdown,
    web,
    conversion,
    
    // Package metadata
    VERSION,
    PACKAGE_NAME
};
