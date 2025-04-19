/**
 * ConversionLogger.js
 *
 * Provides standardized logging methods for conversion processes, integrating
 * with the ConversionStatus module to ensure consistent status tracking and
 * reporting throughout the conversion pipeline.
 *
 * This utility implements a class-based logger with methods for different log
 * levels and specialized methods for tracking conversion pipeline phases.
 *
 * Implements tiered buffer sanitization through LogSanitizer:
 * - Small buffers (<1MB): Include truncated preview
 * - Medium buffers (1-50MB): Include metadata only
 * - Large buffers (>50MB): Basic metadata only
 *
 * Related Files:
 * - src/electron/utils/logging/LogSanitizer.js: Handles buffer sanitization
 * - src/electron/utils/conversion/ConversionStatus.js: Provides status constants and utilities
 * - src/electron/services/conversion/multimedia/VideoConverter.js: Uses logger for conversion tracking
 * - src/electron/services/conversion/multimedia/AudioConverter.js: Uses logger for conversion tracking
 */

const ConversionStatus = require('../../utils/conversion/ConversionStatus');
const { sanitizeForLogging, createSanitizer, DEFAULT_CONFIG } = require('./LogSanitizer');

// Configuration for conversion option sanitization
const CONVERSION_SANITIZE_CONFIG = {
  ...DEFAULT_CONFIG,
  maxLength: 50, // Limit array lengths for conversion options
  previewLength: 32, // Smaller preview for buffer contents
  truncateBuffers: true // Always truncate buffer contents
};

// Create a sanitizer instance with conversion-specific config
const sanitizeConversionOptions = createSanitizer(CONVERSION_SANITIZE_CONFIG);

/**
 * Class representing a conversion process logger
 * Provides standardized logging methods with consistent formatting
 */
class ConversionLogger {
  /**
   * Create a new ConversionLogger instance
   * @param {string} component - Component name (e.g., 'VideoConverter', 'AudioConverter')
   */
  constructor(component) {
    this.component = component;
    this.context = {};
    this.startTime = null;
  }

  /**
   * Set context information for subsequent log messages
   * @param {Object} context - Context information (e.g., conversionId, fileType)
   * @returns {ConversionLogger} - Returns this instance for method chaining
   */
  setContext(context) {
    this.context = { ...this.context, ...context };
    return this;
  }

  /**
   * Clear all context information
   * @returns {ConversionLogger} - Returns this instance for method chaining
   */
  clearContext() {
    this.context = {};
    return this;
  }

  /**
   * Format a log message with component, phase, and file type prefixes
   * @param {string} message - The message to format
   * @param {Object} context - Additional context for this specific message
   * @returns {string} - Formatted message with prefixes
   * @private
   */
  _formatMessage(message, context = {}) {
    const combinedContext = { ...this.context, ...context };
    const phase = combinedContext.phase ? `:${combinedContext.phase}` : '';
    const fileType = combinedContext.fileType ? `[${combinedContext.fileType}]` : '';
    
    return `[${this.component}${phase}]${fileType} ${message}`;
  }

  /**
   * Format timing information in a human-readable way
   * @param {number} timing - Timing in milliseconds
   * @returns {string} - Formatted timing string
   * @private
   */
  _formatTiming(timing) {
    if (timing < 1000) {
      return `${timing}ms`;
    } else if (timing < 60000) {
      return `${(timing / 1000).toFixed(2)}s`;
    } else {
      const minutes = Math.floor(timing / 60000);
      const seconds = ((timing % 60000) / 1000).toFixed(1);
      return `${minutes}m ${seconds}s`;
    }
  }

  /**
   * Calculate elapsed time since conversion start or provided start time
   * @param {number} [startTimeOverride] - Optional start time to calculate from
   * @returns {number} - Elapsed time in milliseconds
   * @private
   */
  _getElapsedTime(startTimeOverride) {
    const start = startTimeOverride || this.startTime;
    if (!start) return 0;
    
    return Date.now() - start;
  }

  /**
   * Log a debug message
   * @param {string} message - Message to log
   * @param {Object} [context] - Additional context for this message
   */
  debug(message, context = {}) {
    console.debug(this._formatMessage(message, context));
  }

  /**
   * Log an info message
   * @param {string} message - Message to log
   * @param {Object} [context] - Additional context for this message
   */
  info(message, context = {}) {
    console.info(this._formatMessage(message, context));
  }

  /**
   * Log a warning message
   * @param {string} message - Message to log
   * @param {Object} [context] - Additional context for this message
   */
  warn(message, context = {}) {
    console.warn(this._formatMessage(message, context));
  }

  /**
   * Log an error message
   * @param {string} message - Message to log
   * @param {Object} [context] - Additional context for this message
   */
  error(message, context = {}) {
    console.error(this._formatMessage(message, context));
  }

  /**
   * Log a success message
   * @param {string} message - Message to log
   * @param {Object} [context] - Additional context for this message
   */
  success(message, context = {}) {
    // Using console.info for success as console doesn't have a native success level
    console.info(this._formatMessage(`✅ ${message}`, context));
  }

  /**
   * Log a phase transition in the conversion pipeline
   * @param {string} fromStatus - Previous status from ConversionStatus.STATUS
   * @param {string} toStatus - New status from ConversionStatus.STATUS
   * @param {number} [timing] - Optional timing information in milliseconds
   */
  logPhaseTransition(fromStatus, toStatus, timing) {
    const fromDesc = ConversionStatus.getStatusDescription(fromStatus);
    const toDesc = ConversionStatus.getStatusDescription(toStatus);
    const toIcon = ConversionStatus.getStatusIcon(toStatus);
    
    let message = `Phase transition: ${fromDesc} → ${toIcon} ${toDesc}`;
    
    if (timing) {
      message += ` (took ${this._formatTiming(timing)})`;
    } else if (this.startTime) {
      const elapsed = this._getElapsedTime();
      message += ` (elapsed: ${this._formatTiming(elapsed)})`;
    }
    
    this.info(message, { phase: toStatus });
  }

  /**
   * Log the start of a conversion process
   * @param {string} fileType - Type of file being converted (e.g., 'mp4', 'pdf')
   * @param {Object} [options] - Conversion options
   */
  logConversionStart(fileType, options = {}) {
    this.startTime = Date.now();
    this.setContext({ fileType, phase: ConversionStatus.STATUS.STARTING });
    
    const icon = ConversionStatus.getStatusIcon(ConversionStatus.STATUS.STARTING);
    let message = `${icon} Starting conversion`;
    
    if (options && Object.keys(options).length > 0) {
      try {
        // Log raw options structure for debugging
        this.debug(`Raw options type: ${typeof options}, keys: ${Object.keys(options)}`);
        
        // Use conversion-specific sanitizer for better buffer handling
        const sanitizedOptions = sanitizeConversionOptions(options);
        
        // Log sanitized structure before stringifying
        this.debug(`Sanitized options structure: ${Object.keys(sanitizedOptions)}`);
        
        // Try to stringify with fallback for large objects
        try {
          message += ` with options: ${JSON.stringify(sanitizedOptions)}`;
        } catch (jsonErr) {
          // If stringification fails, provide basic option info
          this.warn(`Could not stringify full options: ${jsonErr.message}`);
          message += ` with options: {keys: [${Object.keys(sanitizedOptions).join(', ')}]}`;
        }
      } catch (err) {
        // Log error but continue conversion process
        this.error(`Failed to process options: ${err.message}`, { error: err });
        this.debug(`Options processing error: ${err.stack}`);
        
        // Include basic options info in message
        message += ` with options: {type: ${typeof options}}`;
      }
    }
    
    this.info(message);
  }

  /**
   * Log the successful completion of a conversion
   * @param {string} fileType - Type of file that was converted
   * @param {number} [timing] - Optional explicit timing in milliseconds
   */
  logConversionComplete(fileType, timing) {
    const elapsed = timing || this._getElapsedTime();
    const formattedTime = this._formatTiming(elapsed);
    
    this.setContext({ fileType, phase: ConversionStatus.STATUS.COMPLETED });
    
    const icon = ConversionStatus.getStatusIcon(ConversionStatus.STATUS.COMPLETED);
    this.success(`${icon} Conversion completed successfully in ${formattedTime}`);
    
    // Reset start time after completion
    this.startTime = null;
  }

  /**
   * Log a conversion error
   * @param {string} fileType - Type of file that was being converted
   * @param {Error|string} error - Error object or message
   */
  logConversionError(fileType, error) {
    this.setContext({ fileType, phase: ConversionStatus.STATUS.ERROR });
    
    const icon = ConversionStatus.getStatusIcon(ConversionStatus.STATUS.ERROR);
    const errorMessage = error instanceof Error ? error.message : error;
    
    this.error(`${icon} Conversion failed: ${errorMessage}`);
    
    if (error instanceof Error && error.stack) {
      this.debug(`Error stack: ${error.stack}`);
    }
    
    // Reset start time after error
    this.startTime = null;
  }

}

// Singleton instance map to ensure consistent logger instances per component
const loggers = new Map();

/**
 * Get a ConversionLogger instance for a specific component
 * @param {string} component - Component name
 * @returns {ConversionLogger} - Logger instance for the component
 */
function getLogger(component) {
  if (!loggers.has(component)) {
    loggers.set(component, new ConversionLogger(component));
  }
  return loggers.get(component);
}

/**
 * Reset all loggers (mainly for testing purposes)
 */
function resetLoggers() {
  loggers.clear();
}

module.exports = {
  ConversionLogger,
  getLogger,
  resetLoggers
};