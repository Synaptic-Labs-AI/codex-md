/**
 * ConversionStatus.js
 * 
 * Defines the conversion pipeline stages and provides utilities for tracking
 * and describing conversion status throughout the application.
 * 
 * This module centralizes all status-related constants and utilities to ensure
 * consistent status handling across different converters and the UI.
 * 
 * Related Files:
 * - src/electron/services/conversion/ConverterRegistry.js: Uses status constants for tracking conversions
 * - src/electron/services/conversion/multimedia/VideoConverter.js: Updates conversion status
 * - src/electron/services/conversion/multimedia/AudioConverter.js: Updates conversion status
 * - src/electron/utils/conversion/progress.js: Tracks progress alongside status
 */

/**
 * Conversion status constants representing all pipeline stages
 * @enum {string}
 */
const STATUS = {
  /** Initial state when conversion is first requested */
  STARTING: 'starting',
  
  /** Validating input file and parameters */
  VALIDATING: 'validating',
  
  /** Attempting quick conversion method */
  FAST_ATTEMPT: 'fast_attempt',
  
  /** Content was found to be empty */
  CONTENT_EMPTY: 'content_empty',
  
  /** Fallback conversion method has started */
  FALLBACK_STARTED: 'fallback_started',
  
  /** General processing state */
  PROCESSING: 'processing',
  
  /** Extracting audio from media file */
  EXTRACTING_AUDIO: 'extracting_audio',
  
  /** Transcribing audio content */
  TRANSCRIBING: 'transcribing',
  
  /** Generating thumbnails for media */
  GENERATING_THUMBNAILS: 'generating_thumbnails',
  
  /** Conversion successfully completed */
  COMPLETED: 'completed',
  
  /** Conversion failed with an error */
  ERROR: 'failed'
};

/**
 * Maps status constants to human-readable descriptions
 * @param {string} status - Status constant from STATUS enum
 * @returns {string} Human-readable description
 */
function getStatusDescription(status) {
  const descriptions = {
    [STATUS.STARTING]: 'Starting conversion',
    [STATUS.VALIDATING]: 'Validating file',
    [STATUS.FAST_ATTEMPT]: 'Attempting fast conversion',
    [STATUS.CONTENT_EMPTY]: 'Content is empty',
    [STATUS.FALLBACK_STARTED]: 'Starting fallback conversion method',
    [STATUS.PROCESSING]: 'Processing file',
    [STATUS.EXTRACTING_AUDIO]: 'Extracting audio',
    [STATUS.TRANSCRIBING]: 'Transcribing audio',
    [STATUS.GENERATING_THUMBNAILS]: 'Generating thumbnails',
    [STATUS.COMPLETED]: 'Conversion completed',
    [STATUS.ERROR]: 'Conversion failed'
  };

  return descriptions[status] || 'Unknown status';
}

/**
 * Checks if a status represents an error state
 * @param {string} status - Status constant from STATUS enum
 * @returns {boolean} True if status represents an error
 */
function isErrorStatus(status) {
  return status === STATUS.ERROR || status === STATUS.CONTENT_EMPTY;
}

/**
 * Checks if a status represents a completed state
 * @param {string} status - Status constant from STATUS enum
 * @returns {boolean} True if status represents completion
 */
function isCompletedStatus(status) {
  return status === STATUS.COMPLETED;
}

/**
 * Checks if a status represents an in-progress state
 * @param {string} status - Status constant from STATUS enum
 * @returns {boolean} True if status represents an in-progress state
 */
function isInProgressStatus(status) {
  return !isErrorStatus(status) && !isCompletedStatus(status);
}

/**
 * Gets an appropriate emoji/icon for each status
 * @param {string} status - Status constant from STATUS enum
 * @returns {string} Emoji or icon representing the status
 */
function getStatusIcon(status) {
  const icons = {
    [STATUS.STARTING]: '🚀',
    [STATUS.VALIDATING]: '🔍',
    [STATUS.FAST_ATTEMPT]: '⚡',
    [STATUS.CONTENT_EMPTY]: '📭',
    [STATUS.FALLBACK_STARTED]: '🔄',
    [STATUS.PROCESSING]: '⚙️',
    [STATUS.EXTRACTING_AUDIO]: '🔊',
    [STATUS.TRANSCRIBING]: '🎤',
    [STATUS.GENERATING_THUMBNAILS]: '🖼️',
    [STATUS.COMPLETED]: '✅',
    [STATUS.ERROR]: '❌'
  };

  return icons[status] || '❓';
}

/**
 * Gets a color code for each status (useful for UI display)
 * @param {string} status - Status constant from STATUS enum
 * @returns {string} Color code representing the status
 */
function getStatusColor(status) {
  if (isErrorStatus(status)) {
    return '#e74c3c'; // Red for errors
  } else if (isCompletedStatus(status)) {
    return '#2ecc71'; // Green for completion
  } else {
    return '#3498db'; // Blue for in-progress
  }
}

/**
 * Determines if a status should show a progress indicator
 * @param {string} status - Status constant from STATUS enum
 * @returns {boolean} True if status should show progress
 */
function shouldShowProgress(status) {
  // These statuses typically involve operations that take time and should show progress
  const progressStatuses = [
    STATUS.PROCESSING,
    STATUS.EXTRACTING_AUDIO,
    STATUS.TRANSCRIBING,
    STATUS.GENERATING_THUMBNAILS,
    STATUS.FAST_ATTEMPT,
    STATUS.FALLBACK_STARTED
  ];
  
  return progressStatuses.includes(status);
}

module.exports = {
  STATUS,
  getStatusDescription,
  isErrorStatus,
  isCompletedStatus,
  isInProgressStatus,
  getStatusIcon,
  getStatusColor,
  shouldShowProgress
};