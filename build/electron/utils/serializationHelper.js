"use strict";

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
      // Handle large strings by truncating if needed
      if (typeof obj === 'string' && obj.length > 1000000) {
        console.warn(`⚠️ [SerializationHelper] Truncating large string (${obj.length} chars)`);
        return obj.substring(0, 1000000) + '... [truncated]';
      }
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

      // Skip very large string properties that might cause serialization issues
      if (typeof value === 'string' && value.length > 1000000) {
        console.warn(`⚠️ [SerializationHelper] Skipping large string property ${key} (${value.length} chars)`);
        sanitized[key] = '[Large string truncated]';
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
      return this.safeStringify(obj) !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Safely stringify an object with size limits
   * @param {*} obj - Object to stringify
   * @returns {string|null} - JSON string or null if failed
   */
  safeStringify(obj) {
    try {
      // First sanitize the object
      const sanitized = this.sanitizeForSerialization(obj);

      // Then try to stringify
      return JSON.stringify(sanitized);
    } catch (error) {
      console.error(`❌ [SerializationHelper] Stringify error:`, error);
      return null;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJTZXJpYWxpemF0aW9uSGVscGVyIiwic2FuaXRpemVGb3JTZXJpYWxpemF0aW9uIiwib2JqIiwic2VlbiIsIlNldCIsInVuZGVmaW5lZCIsImxlbmd0aCIsImNvbnNvbGUiLCJ3YXJuIiwic3Vic3RyaW5nIiwiRGF0ZSIsInRvSVNPU3RyaW5nIiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJ0eXBlIiwiZGF0YSIsIkFycmF5IiwiZnJvbSIsImlzQXJyYXkiLCJoYXMiLCJhZGQiLCJtYXAiLCJpdGVtIiwic2FuaXRpemVkIiwia2V5IiwidmFsdWUiLCJPYmplY3QiLCJlbnRyaWVzIiwic3RhcnRzV2l0aCIsImNhbkJlQ2xvbmVkIiwic2FmZVN0cmluZ2lmeSIsImVycm9yIiwiSlNPTiIsInN0cmluZ2lmeSIsInJlY29uc3RydWN0QnVmZmVyIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi91dGlscy9zZXJpYWxpemF0aW9uSGVscGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBTZXJpYWxpemF0aW9uIEhlbHBlclxyXG4gKiBcclxuICogVXRpbGl0aWVzIGZvciBlbnN1cmluZyBvYmplY3RzIGNhbiBiZSBzYWZlbHkgc2VyaWFsaXplZCBmb3IgSVBDIGNvbW11bmljYXRpb24uXHJcbiAqIEhhbmRsZXMgc2FuaXRpemluZyBvYmplY3RzLCByZW1vdmluZyBub24tc2VyaWFsaXphYmxlIHByb3BlcnRpZXMsIGFuZCB2YWxpZGF0aW5nIHNlcmlhbGl6YXRpb24uXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9Xb3JrZXJNYW5hZ2VyLmpzOiBVc2VzIHRoaXMgZm9yIHdvcmtlciBjb21tdW5pY2F0aW9uXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3dvcmtlcnMvY29udmVyc2lvbi13b3JrZXIuanM6IFVzZXMgdGhpcyBmb3IgcmVzdWx0IHNhbml0aXphdGlvblxyXG4gKi9cclxuXHJcbmNsYXNzIFNlcmlhbGl6YXRpb25IZWxwZXIge1xyXG4gIC8qKlxyXG4gICAqIFNhbml0aXplIGFuIG9iamVjdCBmb3Igc2VyaWFsaXphdGlvblxyXG4gICAqIEBwYXJhbSB7Kn0gb2JqIC0gT2JqZWN0IHRvIHNhbml0aXplXHJcbiAgICogQHBhcmFtIHtTZXR9IFtzZWVuXSAtIFNldCBvZiBhbHJlYWR5IHNlZW4gb2JqZWN0cyAoZm9yIGNpcmN1bGFyIHJlZmVyZW5jZSBkZXRlY3Rpb24pXHJcbiAgICogQHJldHVybnMgeyp9IC0gU2FuaXRpemVkIG9iamVjdFxyXG4gICAqL1xyXG4gIHNhbml0aXplRm9yU2VyaWFsaXphdGlvbihvYmosIHNlZW4gPSBuZXcgU2V0KCkpIHtcclxuICAgIC8vIEhhbmRsZSBudWxsL3VuZGVmaW5lZFxyXG4gICAgaWYgKG9iaiA9PT0gbnVsbCB8fCBvYmogPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICByZXR1cm4gb2JqO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgcHJpbWl0aXZlc1xyXG4gICAgaWYgKHR5cGVvZiBvYmogIT09ICdvYmplY3QnICYmIHR5cGVvZiBvYmogIT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgLy8gSGFuZGxlIGxhcmdlIHN0cmluZ3MgYnkgdHJ1bmNhdGluZyBpZiBuZWVkZWRcclxuICAgICAgaWYgKHR5cGVvZiBvYmogPT09ICdzdHJpbmcnICYmIG9iai5sZW5ndGggPiAxMDAwMDAwKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gW1NlcmlhbGl6YXRpb25IZWxwZXJdIFRydW5jYXRpbmcgbGFyZ2Ugc3RyaW5nICgke29iai5sZW5ndGh9IGNoYXJzKWApO1xyXG4gICAgICAgIHJldHVybiBvYmouc3Vic3RyaW5nKDAsIDEwMDAwMDApICsgJy4uLiBbdHJ1bmNhdGVkXSc7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIG9iajtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gSGFuZGxlIGZ1bmN0aW9uc1xyXG4gICAgaWYgKHR5cGVvZiBvYmogPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDsgLy8gUmVtb3ZlIGZ1bmN0aW9uc1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBIYW5kbGUgRGF0ZSBvYmplY3RzXHJcbiAgICBpZiAob2JqIGluc3RhbmNlb2YgRGF0ZSkge1xyXG4gICAgICByZXR1cm4gb2JqLnRvSVNPU3RyaW5nKCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEhhbmRsZSBCdWZmZXIgb2JqZWN0c1xyXG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmopKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgdHlwZTogJ0J1ZmZlcicsXHJcbiAgICAgICAgZGF0YTogQXJyYXkuZnJvbShvYmopXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEhhbmRsZSBhcnJheXNcclxuICAgIGlmIChBcnJheS5pc0FycmF5KG9iaikpIHtcclxuICAgICAgLy8gQ2hlY2sgZm9yIGNpcmN1bGFyIHJlZmVyZW5jZXNcclxuICAgICAgaWYgKHNlZW4uaGFzKG9iaikpIHtcclxuICAgICAgICByZXR1cm4gJ1tDaXJjdWxhciBSZWZlcmVuY2VdJztcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQWRkIHRvIHNlZW4gb2JqZWN0c1xyXG4gICAgICBzZWVuLmFkZChvYmopO1xyXG4gICAgICBcclxuICAgICAgLy8gU2FuaXRpemUgYXJyYXkgZWxlbWVudHNcclxuICAgICAgcmV0dXJuIG9iai5tYXAoaXRlbSA9PiB0aGlzLnNhbml0aXplRm9yU2VyaWFsaXphdGlvbihpdGVtLCBzZWVuKSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEhhbmRsZSBvYmplY3RzXHJcbiAgICAvLyBDaGVjayBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlc1xyXG4gICAgaWYgKHNlZW4uaGFzKG9iaikpIHtcclxuICAgICAgcmV0dXJuICdbQ2lyY3VsYXIgUmVmZXJlbmNlXSc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEFkZCB0byBzZWVuIG9iamVjdHNcclxuICAgIHNlZW4uYWRkKG9iaik7XHJcbiAgICBcclxuICAgIC8vIENyZWF0ZSBhIG5ldyBvYmplY3Qgd2l0aCBzYW5pdGl6ZWQgcHJvcGVydGllc1xyXG4gICAgY29uc3Qgc2FuaXRpemVkID0ge307XHJcbiAgICBcclxuICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKG9iaikpIHtcclxuICAgICAgLy8gU2tpcCBmdW5jdGlvbnMgYW5kIHByb3BlcnRpZXMgdGhhdCBzdGFydCB3aXRoIHVuZGVyc2NvcmVcclxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ2Z1bmN0aW9uJyB8fCBrZXkuc3RhcnRzV2l0aCgnXycpKSB7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNraXAgdmVyeSBsYXJnZSBzdHJpbmcgcHJvcGVydGllcyB0aGF0IG1pZ2h0IGNhdXNlIHNlcmlhbGl6YXRpb24gaXNzdWVzXHJcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnICYmIHZhbHVlLmxlbmd0aCA+IDEwMDAwMDApIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbU2VyaWFsaXphdGlvbkhlbHBlcl0gU2tpcHBpbmcgbGFyZ2Ugc3RyaW5nIHByb3BlcnR5ICR7a2V5fSAoJHt2YWx1ZS5sZW5ndGh9IGNoYXJzKWApO1xyXG4gICAgICAgIHNhbml0aXplZFtrZXldID0gJ1tMYXJnZSBzdHJpbmcgdHJ1bmNhdGVkXSc7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFNhbml0aXplIHRoZSB2YWx1ZVxyXG4gICAgICBzYW5pdGl6ZWRba2V5XSA9IHRoaXMuc2FuaXRpemVGb3JTZXJpYWxpemF0aW9uKHZhbHVlLCBzZWVuKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHNhbml0aXplZDtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrIGlmIGFuIG9iamVjdCBjYW4gYmUgY2xvbmVkIChzZXJpYWxpemVkKVxyXG4gICAqIEBwYXJhbSB7Kn0gb2JqIC0gT2JqZWN0IHRvIGNoZWNrXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgb2JqZWN0IGNhbiBiZSBjbG9uZWRcclxuICAgKi9cclxuICBjYW5CZUNsb25lZChvYmopIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFRyeSB0byBzdHJpbmdpZnkgdGhlIG9iamVjdFxyXG4gICAgICByZXR1cm4gdGhpcy5zYWZlU3RyaW5naWZ5KG9iaikgIT09IG51bGw7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG4gIFxyXG4gIC8qKlxyXG4gICAqIFNhZmVseSBzdHJpbmdpZnkgYW4gb2JqZWN0IHdpdGggc2l6ZSBsaW1pdHNcclxuICAgKiBAcGFyYW0geyp9IG9iaiAtIE9iamVjdCB0byBzdHJpbmdpZnlcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfG51bGx9IC0gSlNPTiBzdHJpbmcgb3IgbnVsbCBpZiBmYWlsZWRcclxuICAgKi9cclxuICBzYWZlU3RyaW5naWZ5KG9iaikge1xyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRmlyc3Qgc2FuaXRpemUgdGhlIG9iamVjdFxyXG4gICAgICBjb25zdCBzYW5pdGl6ZWQgPSB0aGlzLnNhbml0aXplRm9yU2VyaWFsaXphdGlvbihvYmopO1xyXG4gICAgICBcclxuICAgICAgLy8gVGhlbiB0cnkgdG8gc3RyaW5naWZ5XHJcbiAgICAgIHJldHVybiBKU09OLnN0cmluZ2lmeShzYW5pdGl6ZWQpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtTZXJpYWxpemF0aW9uSGVscGVyXSBTdHJpbmdpZnkgZXJyb3I6YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlY29uc3RydWN0IGEgQnVmZmVyIGZyb20gaXRzIHNlcmlhbGl6ZWQgZm9ybVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvYmogLSBTZXJpYWxpemVkIEJ1ZmZlciBvYmplY3RcclxuICAgKiBAcmV0dXJucyB7QnVmZmVyfSAtIFJlY29uc3RydWN0ZWQgQnVmZmVyXHJcbiAgICovXHJcbiAgcmVjb25zdHJ1Y3RCdWZmZXIob2JqKSB7XHJcbiAgICBpZiAob2JqICYmIG9iai50eXBlID09PSAnQnVmZmVyJyAmJiBBcnJheS5pc0FycmF5KG9iai5kYXRhKSkge1xyXG4gICAgICByZXR1cm4gQnVmZmVyLmZyb20ob2JqLmRhdGEpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG9iajtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gU2VyaWFsaXphdGlvbkhlbHBlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLG1CQUFtQixDQUFDO0VBQ3hCO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFQyx3QkFBd0JBLENBQUNDLEdBQUcsRUFBRUMsSUFBSSxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDOUM7SUFDQSxJQUFJRixHQUFHLEtBQUssSUFBSSxJQUFJQSxHQUFHLEtBQUtHLFNBQVMsRUFBRTtNQUNyQyxPQUFPSCxHQUFHO0lBQ1o7O0lBRUE7SUFDQSxJQUFJLE9BQU9BLEdBQUcsS0FBSyxRQUFRLElBQUksT0FBT0EsR0FBRyxLQUFLLFVBQVUsRUFBRTtNQUN4RDtNQUNBLElBQUksT0FBT0EsR0FBRyxLQUFLLFFBQVEsSUFBSUEsR0FBRyxDQUFDSSxNQUFNLEdBQUcsT0FBTyxFQUFFO1FB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