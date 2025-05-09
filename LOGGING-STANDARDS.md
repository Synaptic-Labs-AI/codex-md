# Logging Standards

This document outlines the standard patterns for logging in the Codex MD application.

## Proper Logger Usage Patterns

### Core Logging Pattern

The application uses a standardized logging approach across all files:

```javascript
logger.log(message, level = 'INFO', context = {});
```

**Parameters:**
- `message`: The log message (string)
- `level`: Log level - 'INFO', 'DEBUG', 'WARN', 'ERROR' (default: 'INFO')
- `context`: Optional metadata object with additional context

### Examples

```javascript
// Standard info logging
logger.log('Operation completed successfully', 'INFO');

// Info logging with context
logger.log('File processing started', 'INFO', { filePath, fileSize });

// Warning logging
logger.log('Resource usage approaching limit', 'WARN', { usage: '85%' });

// Error logging
logger.log('Failed to process file', 'ERROR', { error });

// Debug logging
logger.log('Internal state', 'DEBUG', { state });
```

### IMPORTANT: Use log() Instead of Specialized Methods

For consistency across the codebase, **always use the `log()` method** rather than individual level methods:

```javascript
// ❌ DON'T use this pattern
logger.info('Operation completed');

// ✅ DO use this pattern
logger.log('Operation completed', 'INFO');
```

## Logger Classes

The application has two main logger implementations:

1. **Core Logger** (`src/electron/utils/logger.js`) - For general application logging
2. **ConversionLogger** (`src/electron/utils/logging/ConversionLogger.js`) - For specialized conversion process logging

Both implementations support the standardized `log(message, level, context)` pattern.

## Logging Contexts

When providing context to log messages, consider these best practices:

- Include relevant file paths for file operations
- Include operation IDs or conversion IDs when available
- Include state information that helps with debugging
- Avoid including sensitive data or full file contents
- For large objects or buffers, use the sanitization utilities

## Log Sanitization

Use `sanitizeForLogging()` from `LogSanitizer.js` when logging objects that may contain:

- Binary data/buffers
- Sensitive information
- Circular references
- Very large objects

```javascript
const { sanitizeForLogging } = require('../utils/logging/LogSanitizer');
logger.log('Request data', 'INFO', sanitizeForLogging(requestData));