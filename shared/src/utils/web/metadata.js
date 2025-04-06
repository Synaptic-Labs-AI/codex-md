/**
 * Web metadata extraction utilities (ES Module version)
 */

// Use dynamic import for cheerio (ES module)
import cheerio from 'cheerio';

// Use dynamic import for node-fetch (ES module)
let fetchModule;

/**
 * Extracts metadata from a webpage
 * @param {string} url - URL of the webpage
 * @returns {Promise<object>} - Extracted metadata
 */
export async function extractMetadata(url) {
    try {
        // Dynamically import node-fetch if not already loaded
        if (!fetchModule) {
            fetchModule = await import('node-fetch');
        }
        const fetch = fetchModule.default;
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch URL: ${response.status}`);
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Base metadata object
        const metadata = {
            title: '',
            description: '',
            author: '',
            date: '',
            source: url,
            site: '',
            captured: new Date().toISOString()
        };

        // Extract title (try multiple sources)
        metadata.title = 
            $('meta[property="og:title"]').attr('content') ||
            $('meta[name="twitter:title"]').attr('content') ||
            $('title').text() ||
            new URL(url).hostname;

        // Extract description
        metadata.description = 
            $('meta[property="og:description"]').attr('content') ||
            $('meta[name="description"]').attr('content') ||
            $('meta[name="twitter:description"]').attr('content') ||
            '';

        // Extract author
        metadata.author = 
            $('meta[name="author"]').attr('content') ||
            $('meta[property="article:author"]').attr('content') ||
            '';

        // Extract publication date
        metadata.date = 
            $('meta[property="article:published_time"]').attr('content') ||
            $('meta[name="publication_date"]').attr('content') ||
            '';

        // Extract site name
        metadata.site = 
            $('meta[property="og:site_name"]').attr('content') ||
            new URL(url).hostname;
        
        // Extract any available images
        metadata.images = [
            $('meta[property="og:image"]').attr('content'),
            $('meta[name="twitter:image"]').attr('content')
        ].filter(Boolean);

        // Extract keywords/tags
        const keywords = $('meta[name="keywords"]').attr('content');
        if (keywords) {
            metadata.keywords = keywords.split(',').map(k => k.trim());
        }

        // Clean up metadata
        return cleanMetadata(metadata);

    } catch (error) {
        console.error('Metadata extraction error:', error);
        // Return basic metadata even if extraction fails
        return {
            title: new URL(url).hostname,
            source: url,
            captured: new Date().toISOString()
        };
    }
}

/**
 * Clean up metadata object by removing empty values
 * @param {object} metadata - Metadata to clean
 * @returns {object} - Cleaned metadata
 */
function cleanMetadata(metadata) {
    const cleaned = {};

    Object.entries(metadata).forEach(([key, value]) => {
        // Handle strings
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed) {
                cleaned[key] = trimmed;
            }
        }
        // Handle arrays
        else if (Array.isArray(value)) {
            if (value.length > 0) {
                cleaned[key] = value.filter(Boolean);
            }
        }
        // Handle other values
        else if (value !== null && value !== undefined) {
            cleaned[key] = value;
        }
    });

    return cleaned;
}

/**
 * Extracts the main text content from a webpage
 * @param {string} html - HTML content
 * @returns {string} - Extracted text content
 */
export function extractContent(html) {
    try {
        const $ = cheerio.load(html);

        // Remove unwanted elements
        $('script, style, meta, link, noscript').remove();

        // Extract text from article or main content
        let content = $('article').text() || $('main').text();

        // If no article/main, try common content selectors
        if (!content) {
            content = $('.content, .post-content, .entry-content').text();
        }

        // If still no content, get body text
        if (!content) {
            content = $('body').text();
        }

        // Clean up the text
        return content
            .replace(/\s+/g, ' ')    // Collapse whitespace
            .replace(/\n+/g, '\n\n')  // Normalize line breaks
            .trim();

    } catch (error) {
        console.error('Content extraction error:', error);
        return '';
    }
}

/**
 * Extracts links from a webpage
 * @param {string} html - HTML content
 * @param {string} baseUrl - Base URL for resolving relative links
 * @returns {Promise<Array<{url: string, text: string}>>} - Array of extracted links
 */
export async function extractLinks(html, baseUrl) {
    try {
        const $ = cheerio.load(html);
        const links = [];
        const seenUrls = new Set();

        $('a[href]').each((_, element) => {
            const $link = $(element);
            const href = $link.attr('href');
            
            if (href) {
                try {
                    // Resolve relative URLs
                    const url = new URL(href, baseUrl).href;
                    
                    // Skip duplicates and non-http(s) URLs
                    if (!seenUrls.has(url) && url.match(/^https?:\/\//)) {
                        seenUrls.add(url);
                        links.push({
                            url,
                            text: $link.text().trim()
                        });
                    }
                } catch (error) {
                    // Skip invalid URLs
                }
            }
        });

        return links;

    } catch (error) {
        console.error('Link extraction error:', error);
        return [];
    }
}

// Default export for compatibility
export default {
    extractMetadata,
    extractContent,
    extractLinks
};
