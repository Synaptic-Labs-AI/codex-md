import { convertUrlToMarkdown } from './urlConverter.js';
import { AppError } from '../../../utils/errorHandler.js';
import { SitemapParser } from './utils/SitemapParser.js';

/**
 * Convert a parent URL and its child pages to markdown
 * @param {string} parentUrl - Parent URL to convert  
 * @param {Object} options - Conversion options
 * @returns {Promise} Conversion result
 */
export async function convertParentUrlToMarkdown(parentUrl, options = {}) {
  try {
    // Validate and normalize URL
    let urlObj;
    try {
      urlObj = new URL(parentUrl.startsWith('http') ? parentUrl : `https://${parentUrl}`);
      parentUrl = urlObj.toString();
    } catch (error) {
      throw new AppError(`Invalid URL format: ${error.message}`, 400);
    }

    const hostname = urlObj.hostname;
    console.log(`🚀 Starting conversion of ${parentUrl}`);

    // Send a single initial progress event
    if (options.onProgress) {
      options.onProgress({
        status: 'converting',
        websiteUrl: parentUrl,
        startTime: Date.now(),
        progress: 10,
        message: `Starting conversion of ${hostname}`
      });
    }

    // Initialize sitemap parser
    const sitemapParser = new SitemapParser({
      maxEntries: options.maxPages || 1000,
      timeout: options.timeout || 30000
    });

    // Find URLs to process
    let urlsToProcess = new Set();

    // Initialize sitemap parser (without sending progress events)
    const sitemapUrls = await sitemapParser.initialize(parentUrl);

    // Handle sitemap results
    if (sitemapUrls.length > 0) {
      console.log(`📋 Found ${sitemapUrls.length} URLs in sitemap`);
      
      // Filter sitemap URLs if path filter provided
      const filteredUrls = options.pathFilter
        ? sitemapUrls.filter(url => {
            // Handle both string URLs and URL objects from sitemap
            const urlString = typeof url === 'string' ? url : (url.url || '');
            return urlString.includes(options.pathFilter);
          })
        : sitemapUrls;

      console.log(`📋 After filtering, using ${filteredUrls.length} URLs from sitemap`);
      
      // Add filtered URLs to processing set
      filteredUrls.forEach(url => urlsToProcess.add(url));
    } else {
      console.log(`⚠️ No URLs found in sitemap, will only process parent URL`);
    }

    // Add parent URL if not already included
    urlsToProcess.add(parentUrl);
    const urls = Array.from(urlsToProcess);

    // Process all URLs
    const processedPages = [];
    const totalUrls = urls.length;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        // Validate and normalize URL before conversion
        let urlToConvert;
        try {
          // Handle different URL formats and types
          if (typeof url === 'string') {
            urlToConvert = url;
          } else if (url && typeof url === 'object') {
            // If it's a URL object from sitemap parser
            if (url.url && typeof url.url === 'string') {
              urlToConvert = url.url;
            } else if (typeof url.toString === 'function') {
              const urlString = url.toString();
              // Verify toString() didn't just return [object Object]
              if (urlString === '[object Object]') {
                console.warn(`Skipping invalid URL object: ${JSON.stringify(url)}`);
                continue; // Skip this URL
              }
              urlToConvert = urlString;
            } else {
              console.warn(`Skipping URL with invalid format: ${JSON.stringify(url)}`);
              continue; // Skip this URL
            }
          } else {
            console.warn(`Skipping URL with invalid type: ${typeof url}`);
            continue; // Skip this URL
          }
          
          // Ensure URL has proper protocol
          if (!urlToConvert.startsWith('http://') && !urlToConvert.startsWith('https://')) {
            urlToConvert = `https://${urlToConvert}`;
          }
          
          // Validate URL by attempting to create a URL object
          new URL(urlToConvert); // This will throw if invalid
        } catch (urlError) {
          console.warn(`Skipping invalid URL: ${urlError.message}`, url);
          processedPages.push({
            url: typeof url === 'string' ? url : JSON.stringify(url),
            error: `Invalid URL format: ${urlError.message}`,
            success: false
          });
          continue; // Skip this URL
        }
        
        // Now process the validated URL
        const result = await convertUrlToMarkdown(urlToConvert, options);
        processedPages.push({
          url: urlToConvert,
          content: result.content,
          metadata: result.metadata,
          success: true
        });

      } catch (error) {
        console.error(`Failed to convert ${typeof url === 'string' ? url : JSON.stringify(url)}:`, error);
        processedPages.push({
          url: typeof url === 'string' ? url : JSON.stringify(url),
          error: error.message,
          success: false
        });
      }
    }

    // Generate output files
    const { files, indexContent } = generateOutputFiles(parentUrl, processedPages, hostname);

    // Send a single final progress event
    if (options.onProgress) {
      const successCount = processedPages.filter(p => p.success).length;
      const failedCount = processedPages.filter(p => !p.success).length;
      const sections = new Set();
      
      // Extract sections for reporting
      processedPages.forEach(page => {
        try {
          if (page.success) {
            const urlObj = new URL(page.url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            const section = pathParts[0] || 'main';
            sections.add(section);
          }
        } catch (error) {
          // Ignore errors in section extraction for reporting
        }
      });
      
      options.onProgress({
        status: 'completed',
        websiteUrl: parentUrl,
        processedCount: processedPages.length,
        totalCount: processedPages.length,
        successCount: successCount,
        failedCount: failedCount,
        sectionCount: sections.size,
        sections: Array.from(sections),
        progress: 100, // Explicitly set to 100%
        message: `Completed scraping ${hostname}: ${successCount} pages successful, ${failedCount} failed, ${sections.size} sections`
      });
    }

    return {
      url: parentUrl,
      type: 'parenturl',
      name: hostname,
      content: indexContent,
      files,
      success: true,
      stats: {
        totalPages: processedPages.length,
        successfulPages: processedPages.filter(p => p.success).length,
        failedPages: processedPages.filter(p => !p.success).length
      }
    };

  } catch (error) {
    console.error('Parent URL conversion failed:', error);
    throw new AppError(
      error instanceof AppError ? error.message : `Failed to convert parent URL: ${error.message}`,
      error instanceof AppError ? error.statusCode : 500
    );
  }
}

/**
 * Generate output files including index
 * All files are organized in a dedicated folder for the website
 * @private
 */
function generateOutputFiles(parentUrl, pages, hostname) {
  const successfulPages = pages.filter(p => p.success);
  const failedPages = pages.filter(p => !p.success);
  const timestamp = new Date().toISOString();
  
  // Generate a folder name for the website
  const folderName = generateFolderName(hostname, timestamp);

  // Group pages by sections
  const sections = new Map();
  const processedPaths = new Set();

  successfulPages.forEach(page => {
    try {
      const urlObj = new URL(page.url);
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      const section = pathParts[0] || 'main';

      if (!sections.has(section)) {
        sections.set(section, []);
      }
      
      const pathKey = urlObj.pathname;
      if (!processedPaths.has(pathKey)) {
        processedPaths.add(pathKey);
        sections.get(section).push(page);
      }
    } catch (error) {
      console.error('Error processing page section:', error);
    }
  });

  // Generate index content
  const indexContent = [
    `# ${hostname} Website Archive\n`,
    '## Site Information\n',
    `- **Source:** ${parentUrl}`,
    `- **Archived:** ${timestamp}`,
    `- **Total Pages:** ${pages.length}`,
    `- **Successfully Converted:** ${successfulPages.length}`,
    `- **Failed:** ${failedPages.length}\n`,
    '## Contents\n',
    ...Array.from(sections.entries()).map(([section, sectionPages]) => [
      `### ${section.charAt(0).toUpperCase() + section.slice(1)}\n`,
      ...sectionPages.map(page => {
        // Generate a safe filename from the URL - same logic as in files array
        let filename;
        try {
          const urlObj = new URL(page.url);
          // Use pathname or hostname if pathname is just '/'
          const pathSegment = urlObj.pathname === '/' ? 
            urlObj.hostname : 
            urlObj.pathname.split('/').pop() || urlObj.hostname;
          
          // Clean the filename and ensure it's valid
          filename = pathSegment
            .replace(/\.[^/.]+$/, '') // Remove file extension if present
            .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars with underscore
            .replace(/_+/g, '_') // Replace multiple underscores with single one
            .toLowerCase();
          
          // Ensure we have a valid filename
          if (!filename || filename === '' || filename === '_') {
            filename = 'page_' + Math.floor(Math.random() * 10000);
          }
        } catch (error) {
          console.warn(`Error generating filename from URL ${page.url}:`, error);
          filename = 'page_' + Math.floor(Math.random() * 10000);
        }
        
        // Use the page title from metadata if available, otherwise use the filename
        const displayName = page.metadata?.title || filename;
        // Note: We don't need to change the internal links as they're relative within the folder
        return `- [[${filename}|${displayName}]] - [Original](${page.url})`;
      }),
      ''
    ]).flat(),
    failedPages.length ? [
      '## Failed Conversions\n',
      ...failedPages.map(page => `- ${page.url}: ${page.error}`),
      ''
    ].join('\n') : ''
  ].join('\n');

  // Create files array with folder prefix
  const files = [
    {
      name: `${folderName}/index.md`,
      content: indexContent,
      type: 'text'
    },
    ...successfulPages.map(page => {
      // Generate a safe filename from the URL
      let filename;
      try {
        const urlObj = new URL(page.url);
        // Use pathname or hostname if pathname is just '/'
        const pathSegment = urlObj.pathname === '/' ? 
          urlObj.hostname : 
          urlObj.pathname.split('/').pop() || urlObj.hostname;
        
        // Clean the filename and ensure it's valid
        filename = pathSegment
          .replace(/\.[^/.]+$/, '') // Remove file extension if present
          .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars with underscore
          .replace(/_+/g, '_') // Replace multiple underscores with single one
          .toLowerCase();
        
        // Ensure we have a valid filename
        if (!filename || filename === '' || filename === '_') {
          filename = 'page_' + Math.floor(Math.random() * 10000);
        }
      } catch (error) {
        console.warn(`Error generating filename from URL ${page.url}:`, error);
        filename = 'page_' + Math.floor(Math.random() * 10000);
      }
      
      return {
        name: `${folderName}/${filename}.md`,
        content: page.content,
        type: 'text'
      };
    })
  ];

  return { files, indexContent };
}

/**
 * Generate a folder name based on hostname and timestamp
 * @param {string} hostname - The website hostname
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} A sanitized folder name
 * @private
 */
function generateFolderName(hostname, timestamp) {
  // Sanitize hostname for folder name
  const sanitizedHostname = hostname
    .replace(/[^a-zA-Z0-9]/g, '-') // Replace invalid chars with hyphen
    .replace(/-+/g, '-')           // Replace multiple hyphens with single one
    .toLowerCase();
  
  // Extract date and time components from timestamp for a more readable format
  const date = new Date(timestamp);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const timeStr = date.toISOString().split('T')[1].substring(0, 8).replace(/:/g, ''); // HHMMSS
  
  // Combine hostname with date and time to ensure uniqueness
  return `${sanitizedHostname}-${dateStr}-${timeStr}`;
}
