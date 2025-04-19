/**
 * LogSanitizer.js
 * 
 * Provides utilities for sanitizing objects before logging, handling common 
 * cases like Buffers, circular references, and deeply nested objects.
 * 
 * Implements a tiered buffer sanitization approach to prevent:
 * - V8 "Invalid string length" errors from large buffers (>512MB)
 * - Memory issues from excessive buffer data in logs
 * - Loss of critical debugging information
 * 
 * Buffer Size Tiers:
 * - Small (<1MB): Include truncated preview of buffer data
 * - Medium (1-50MB): Include only metadata (size, type, hash)
 * - Large (>50MB): Basic metadata only
 * 
 * Related Files:
 * - src/electron/utils/logging/ConversionLogger.js
 * - src/electron/converters/UnifiedConverterFactory.js
 * - src/electron/services/conversion/multimedia/VideoConverter.js
 */

const crypto = require('crypto');

// Buffer size thresholds in bytes
const BUFFER_THRESHOLDS = {
  SMALL: 1024 * 1024, // 1MB
  MEDIUM: 50 * 1024 * 1024 // 50MB
};

/**
 * Configuration object for sanitization options
 * @typedef {Object} SanitizeConfig
 * @property {number} maxDepth - Maximum depth for nested object traversal 
 * @property {number} maxLength - Maximum length for array/buffer preview
 * @property {boolean} truncateBuffers - Whether to truncate buffer contents
 * @property {number} previewLength - Maximum length of buffer data preview
 */

/** @type {SanitizeConfig} */
const DEFAULT_CONFIG = {
  maxDepth: 3,
  maxLength: 100,
  truncateBuffers: true,
  previewLength: 50 // Default preview length for small buffers
};

/**
 * Determines the appropriate sanitization strategy based on buffer size
 * @param {Buffer} buffer - The buffer to classify
 * @returns {'small'|'medium'|'large'} The size classification
 */
function classifyBufferSize(buffer) {
  const size = buffer.length;
  if (size < BUFFER_THRESHOLDS.SMALL) return 'small';
  if (size < BUFFER_THRESHOLDS.MEDIUM) return 'medium';
  return 'large';
}

/**
 * Extracts metadata from a buffer for logging
 * @param {Buffer} buffer - The buffer to extract metadata from
 * @returns {Object} Buffer metadata
 */
function extractBufferMetadata(buffer) {
  // Calculate a hash of the first 16KB to help identify content
  // without processing the entire buffer
  const hash = crypto
    .createHash('sha256')
    .update(buffer.slice(0, 16384))
    .digest('hex')
    .slice(0, 16); // First 16 chars of hash is sufficient

  return {
    size: buffer.length,
    sizeFormatted: formatSize(buffer.length),
    type: detectBufferType(buffer),
    hash
  };
}

/**
 * Formats a byte size into a human-readable string
 * @param {number} bytes - The size in bytes
 * @returns {string} Formatted size string
 */
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)}${units[unitIndex]}`;
}

/**
 * Attempts to detect the type of data in a buffer
 * @param {Buffer} buffer - The buffer to analyze
 * @returns {string} Detected type description
 */
function detectBufferType(buffer) {
  // Check file signatures/magic numbers
  if (buffer.length < 4) return 'unknown';
  
  const header = buffer.slice(0, 4).toString('hex');
  
  // Common file signatures
  if (header.startsWith('89504e47')) return 'image/png';
  if (header.startsWith('ffd8ff')) return 'image/jpeg';
  if (header.startsWith('47494638')) return 'image/gif';
  if (header.startsWith('52494646')) return 'video/webm';
  
  // Try to detect if it's UTF-8 text
  try {
    const sample = buffer.slice(0, 32).toString('utf8');
    if (/^[\x20-\x7F\n\r\t]*$/.test(sample)) return 'text/plain';
  } catch {}
  
  return 'application/octet-stream';
}

/**
 * Sanitizes an object for logging by handling special cases and preventing issues
 * @param {any} obj - The object to sanitize
 * @param {SanitizeConfig} [config] - Configuration options
 * @returns {any} - The sanitized object safe for logging
 */
function sanitizeForLogging(obj, config = DEFAULT_CONFIG) {
  // Use WeakSet to track object references and prevent circular recursion
  const seen = new WeakSet();
  
  /**
   * Internal recursive sanitization function with depth tracking
   * @param {any} value - Value to sanitize
   * @param {number} depth - Current recursion depth
   * @returns {any} - Sanitized value
   */
  function sanitizeValue(value, depth = 0) {
    // Handle null/undefined
    if (value == null) return value;

    // Handle Buffers using tiered approach
    if (Buffer.isBuffer(value)) {
      const sizeClass = classifyBufferSize(value);
      const metadata = extractBufferMetadata(value);

      // Apply tiered sanitization strategy
      switch (sizeClass) {
        case 'small':
          return {
            type: '[Buffer]',
            ...metadata,
            preview: value.slice(0, config.previewLength).toString('hex')
          };
        
        case 'medium':
          return {
            type: '[Buffer]',
            ...metadata
          };
        
        case 'large':
          return {
            type: '[Large Buffer]',
            size: metadata.size,
            sizeFormatted: metadata.sizeFormatted
          };
      }
    }

    // Handle primitive types
    if (typeof value !== 'object') {
      return value;
    }

    // Check for circular references
    if (seen.has(value)) {
      return '[Circular Reference]';
    }

    // Check depth limit
    if (depth >= config.maxDepth) {
      return '[Max Depth Reached]';
    }

    // Track this object to detect circular refs
    seen.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      const sanitizedArray = value.slice(0, config.maxLength).map(item => 
        sanitizeValue(item, depth + 1)
      );
      if (value.length > config.maxLength) {
        sanitizedArray.push(`...${value.length - config.maxLength} more items`);
      }
      return sanitizedArray;
    }

    // Handle special Node.js objects
    if (value._handle || value._readableState || value._writableState) {
      return '[Stream/Handle]';
    }

    // Handle regular objects
    const sanitized = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeValue(val, depth + 1);
    }
    return sanitized;
  }

  return sanitizeValue(obj);
}

/**
 * Creates a sanitizer with custom configuration
 * @param {SanitizeConfig} config - Custom configuration options
 * @returns {function(any): any} - Configured sanitizer function
 */
function createSanitizer(config) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  return (obj) => sanitizeForLogging(obj, finalConfig);
}

module.exports = {
  sanitizeForLogging,
  createSanitizer,
  DEFAULT_CONFIG,
  BUFFER_THRESHOLDS
};