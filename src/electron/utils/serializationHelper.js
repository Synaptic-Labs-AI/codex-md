/**
 * Serialization Helper
 * 
 * Utilities for ensuring objects can be safely serialized for IPC communication.
 * Handles sanitizing objects, removing non-serializable properties, and validating serialization.
 * 
 * Related files:
 * - src/electron/services/WorkerManager.js: Uses this for worker communication
 * - src/electron/workers/conversion-worker.js: Uses this for result sanitization
 */

class SerializationHelper {
  /**
   * Sanitize an object for serialization
   * @param {*} obj - Object to sanitize
   * @param {Set} [seen] - Set of already seen objects (for circular reference detection)
   * @returns {*} - Sanitized object
   */
  sanitizeForSerialization(obj, seen = new Set()) {
    // Handle null/undefined
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    // Handle primitives
    if (typeof obj !== 'object' && typeof obj !== 'function') {
      return obj;
    }
    
    // Handle functions
    if (typeof obj === 'function') {
      return undefined; // Remove functions
    }
    
    // Handle Date objects
    if (obj instanceof Date) {
      return obj.toISOString();
    }
    
    // Handle Buffer objects
    if (Buffer.isBuffer(obj)) {
      return {
        type: 'Buffer',
        data: Array.from(obj)
      };
    }
    
    // Handle arrays
    if (Array.isArray(obj)) {
      // Check for circular references
      if (seen.has(obj)) {
        return '[Circular Reference]';
      }
      
      // Add to seen objects
      seen.add(obj);
      
      // Sanitize array elements
      return obj.map(item => this.sanitizeForSerialization(item, seen));
    }
    
    // Handle objects
    // Check for circular references
    if (seen.has(obj)) {
      return '[Circular Reference]';
    }
    
    // Add to seen objects
    seen.add(obj);
    
    // Create a new object with sanitized properties
    const sanitized = {};
    
    for (const [key, value] of Object.entries(obj)) {
      // Skip functions and properties that start with underscore
      if (typeof value === 'function' || key.startsWith('_')) {
        continue;
      }
      
      // Sanitize the value
      sanitized[key] = this.sanitizeForSerialization(value, seen);
    }
    
    return sanitized;
  }

  /**
   * Check if an object can be cloned (serialized)
   * @param {*} obj - Object to check
   * @returns {boolean} - Whether the object can be cloned
   */
  canBeCloned(obj) {
    try {
      // Try to stringify the object
      JSON.stringify(obj);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Reconstruct a Buffer from its serialized form
   * @param {Object} obj - Serialized Buffer object
   * @returns {Buffer} - Reconstructed Buffer
   */
  reconstructBuffer(obj) {
    if (obj && obj.type === 'Buffer' && Array.isArray(obj.data)) {
      return Buffer.from(obj.data);
    }
    return obj;
  }
}

module.exports = SerializationHelper;