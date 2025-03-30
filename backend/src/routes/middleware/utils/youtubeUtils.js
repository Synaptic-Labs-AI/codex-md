// routes/utils/youtubeUtils.js

// YouTube functionality temporarily removed

/**
 * Extracts YouTube Video ID from URL (temporarily disabled)
 * @param {string} url - The YouTube video URL
 * @returns {string} - The extracted video ID or 'unknown' if not found
 */
export function extractVideoId(url) {
  return 'unknown';
}

/**
 * Formats timestamp from seconds to HH:MM:SS (temporarily disabled)
 * @param {number} seconds - The time in seconds
 * @returns {string} - Formatted timestamp
 */
export function formatTimestamp(seconds) {
  return '00:00:00';
}

/**
 * Extracts YouTube video metadata (temporarily disabled)
 * @param {puppeteer.Page} page - The Puppeteer page instance
 * @returns {Promise<{ title: string }>} - The extracted metadata
 */
export async function extractYoutubeMetadata() {
  return {
    title: 'Untitled Video',
  };
}
