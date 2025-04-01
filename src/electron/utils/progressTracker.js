/**
 * ProgressTracker.js
 * 
 * Utility class for tracking and reporting progress during conversion operations.
 * Provides consistent progress tracking and reporting across all conversion methods.
 * 
 * Related files:
 * - src/electron/services/ElectronConversionService.js: Main consumer of this utility
 * - src/electron/adapters/conversionServiceAdapter.js: Used with backend conversion service
 */

class ProgressTracker {
  /**
   * Create a new progress tracker
   * @param {Function} onProgress - Callback function for progress updates
   * @param {number} [interval=250] - Minimum interval between progress updates in milliseconds
   */
  constructor(onProgress, interval = 250) {
    this.onProgress = onProgress;
    this.interval = interval;
    this.lastUpdate = 0;
  }
  
  /**
   * Update progress if the interval has elapsed
   * @param {number} progress - Progress value (0-100)
   */
  update(progress) {
    const now = Date.now();
    if (this.onProgress && now - this.lastUpdate >= this.interval) {
      this.onProgress(Math.min(Math.round(progress), 100));
      this.lastUpdate = now;
    }
  }
  
  /**
   * Scale a progress value from one range to another
   * @param {number} progress - Current progress value (0-100)
   * @param {number} start - Start of the target range
   * @param {number} end - End of the target range
   * @returns {number} Scaled progress value
   */
  scaleProgress(progress, start, end) {
    return start + (progress * (end - start) / 100);
  }
  
  /**
   * Update progress with scaling
   * @param {number} progress - Current progress value (0-100)
   * @param {number} start - Start of the target range
   * @param {number} end - End of the target range
   */
  updateScaled(progress, start, end) {
    this.update(this.scaleProgress(progress, start, end));
  }
  
  /**
   * Create a progress callback function for a specific range
   * @param {number} start - Start of the range
   * @param {number} end - End of the range
   * @returns {Function} Progress callback function
   */
  createRangeCallback(start, end) {
    return (progress) => this.updateScaled(progress, start, end);
  }
}

module.exports = ProgressTracker;
