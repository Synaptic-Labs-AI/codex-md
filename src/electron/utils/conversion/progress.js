/**
 * Progress Tracking Utilities for Conversion Operations
 * 
 * This module provides a ProgressTracker class that helps manage progress updates
 * during file conversions, ensuring smooth progress reporting and throttling updates
 * to avoid overwhelming the UI.
 * 
 * Used by:
 * - src/electron/converters/UnifiedConverterFactory.js
 */

class ProgressTracker {
    /**
     * Create a new progress tracker
     * @param {Function} callback - Progress update callback
     * @param {number} throttleMs - Minimum time between updates (ms)
     */
    constructor(callback, throttleMs = 250) {
        this.callback = callback;
        this.throttleMs = throttleMs;
        this.lastUpdate = 0;
        this.lastProgress = 0;
    }

    /**
     * Update progress
     * @param {number} progress - Progress value (0-100)
     * @param {Object} details - Additional progress details
     */
    update(progress, details = {}) {
        const now = Date.now();
        if (now - this.lastUpdate >= this.throttleMs || progress === 100 || progress === 0) {
            this.lastUpdate = now;
            this.lastProgress = progress;
            this.callback({
                progress,
                ...details
            });
        }
    }

    /**
     * Update progress scaled to a range
     * @param {number} progress - Input progress (0-100)
     * @param {number} start - Start of range
     * @param {number} end - End of range
     * @param {Object} details - Additional progress details
     */
    updateScaled(progress, start, end, details = {}) {
        const scaled = start + (progress / 100) * (end - start);
        this.update(scaled, details);
    }
}

module.exports = {
    ProgressTracker
};
