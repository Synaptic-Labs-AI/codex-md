/**
 * Progress tracking utilities for conversions (ES Module version)
 */

/**
 * Creates a new progress tracker
 * @param {function} onProgress - Progress callback
 * @param {number} [updateInterval=250] - Minimum ms between updates
 * @returns {Object} Progress tracker instance
 */
export class ProgressTracker {
    constructor(onProgress, updateInterval = 250) {
        this.onProgress = onProgress;
        this.updateInterval = updateInterval;
        this.lastUpdate = 0;
        this.currentProgress = 0;
        this.sections = [];
        this.currentSection = null;
    }

    /**
     * Updates progress percentage
     * @param {number} progress - Progress percentage (0-100)
     */
    update(progress) {
        const now = Date.now();
        
        // Ensure progress is within bounds
        progress = Math.max(0, Math.min(100, progress));
        
        // Only update if enough time has passed or it's the first/last update
        if (progress === 100 || 
            progress === 0 || 
            now - this.lastUpdate >= this.updateInterval) {
            
            this.currentProgress = progress;
            this.lastUpdate = now;
            
            if (this.onProgress) {
                this.onProgress({
                    progress,
                    sections: this.sections,
                    currentSection: this.currentSection
                });
            }
        }
    }

    /**
     * Updates progress scaled within a range
     * @param {number} current - Current progress within total
     * @param {number} rangeStart - Start of range (percentage)
     * @param {number} rangeEnd - End of range (percentage)
     * @param {number} total - Total items
     */
    updateScaled(current, rangeStart, rangeEnd, total) {
        if (total <= 0) return;
        
        const progress = rangeStart + 
            ((current / total) * (rangeEnd - rangeStart));
        
        this.update(progress);
    }

    /**
     * Starts a new section
     * @param {string} name - Section name
     * @param {number} [weight=1] - Section weight in overall progress
     */
    startSection(name, weight = 1) {
        this.sections.push({
            name,
            weight,
            progress: 0,
            completed: false
        });
        this.currentSection = name;
        this.updateSectionProgress();
    }

    /**
     * Completes the current section
     */
    completeSection() {
        const section = this.sections.find(s => s.name === this.currentSection);
        if (section) {
            section.completed = true;
            section.progress = 100;
            this.updateSectionProgress();
        }
    }

    /**
     * Updates progress for current section
     * @param {number} progress - Section progress (0-100)
     */
    updateSectionProgress(progress = null) {
        const section = this.sections.find(s => s.name === this.currentSection);
        if (section && progress !== null) {
            section.progress = Math.max(0, Math.min(100, progress));
        }
        
        // Calculate overall progress based on section weights
        const totalWeight = this.sections.reduce((sum, s) => sum + s.weight, 0);
        const completedProgress = this.sections.reduce((sum, s) => {
            return sum + ((s.progress / 100) * s.weight);
        }, 0);
        
        const overallProgress = totalWeight > 0 
            ? (completedProgress / totalWeight) * 100 
            : this.currentProgress;
        
        this.update(overallProgress);
    }

    /**
     * Gets current progress state
     * @returns {Object} Current progress state
     */
    getState() {
        return {
            progress: this.currentProgress,
            sections: this.sections,
            currentSection: this.currentSection
        };
    }

    /**
     * Resets progress tracker
     */
    reset() {
        this.currentProgress = 0;
        this.sections = [];
        this.currentSection = null;
        this.update(0);
    }
}

// Default export for compatibility
export default {
    ProgressTracker
};
