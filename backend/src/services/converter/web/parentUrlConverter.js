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

    // Initialize sitemap parser
    const sitemapParser = new SitemapParser({
      maxEntries: options.maxPages || 1000,
      timeout: options.timeout || 30000
    });

    // Report initial status
    if (options.onProgress) {
      options.onProgress({
        status: 'initializing',
        websiteUrl: parentUrl,
        startTime: Date.now(),
        progress: 5
      });

      // Give UI time to show initial state
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Find URLs to process
    let urlsToProcess = new Set();

    // First try sitemap
    if (options.onProgress) {
      options.onProgress({
        status: 'finding_sitemap',
        websiteUrl: parentUrl,
        progress: 10
      });
    }

    const sitemapUrls = await sitemapParser.initialize(parentUrl);

    if (sitemapUrls.length > 0) {
      if (options.onProgress) {
        options.onProgress({
          status: 'parsing_sitemap',
          websiteUrl: parentUrl,
          urlCount: sitemapUrls.length,
          progress: 20
        });
      }

      // Filter sitemap URLs if path filter provided
      const filteredUrls = options.pathFilter
        ? sitemapUrls.filter(url => url.startsWith(options.pathFilter))
        : sitemapUrls;

      filteredUrls.forEach(url => urlsToProcess.add(url));
    }

    // Add parent URL if not already included
    urlsToProcess.add(parentUrl);
    const urls = Array.from(urlsToProcess);

    // Process all URLs
    const processedPages = [];
    const totalUrls = urls.length;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      if (options.onProgress) {
        options.onProgress({
          status: 'processing',
          websiteUrl: parentUrl,
          currentUrl: url,
          processedCount: i,
          totalCount: totalUrls,
          progress: 20 + Math.floor((i / totalUrls) * 70)
        });
      }

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

        // Track section progress
        try {
          // Extract URL string from url (which might be an object from sitemap)
          let urlString;
          if (typeof url === 'string') {
            urlString = url;
          } else if (url && typeof url === 'object') {
            // If it's a URL object from sitemap parser
            if (url.url && typeof url.url === 'string') {
              urlString = url.url;
            } else if (typeof url.toString === 'function') {
              const tempString = url.toString();
              // Verify toString() didn't just return [object Object]
              if (tempString === '[object Object]') {
                console.warn(`Skipping section extraction for invalid URL object: ${JSON.stringify(url)}`);
                continue; // Skip section extraction
              }
              urlString = tempString;
            } else {
              console.warn(`Skipping section extraction for URL with invalid format: ${JSON.stringify(url)}`);
              continue; // Skip section extraction
            }
          } else {
            console.warn(`Skipping section extraction for URL with invalid type: ${typeof url}`);
            continue; // Skip section extraction
          }
          
          // Ensure URL has proper protocol
          if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
            urlString = `https://${urlString}`;
          }
          
          const urlObj = new URL(urlString);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          const section = pathParts[0] || 'main';
          
          if (options.onProgress) {
            options.onProgress({
              status: 'section',
              websiteUrl: parentUrl,
              section: section.charAt(0).toUpperCase() + section.slice(1),
              count: 1,
              progress: 20 + Math.floor((i / totalUrls) * 70), // Include current progress
              processedCount: i,
              totalCount: totalUrls
            });
          }
        } catch (error) {
          console.error('Error extracting section:', error, typeof url === 'object' ? JSON.stringify(url) : url);
        }
      } catch (error) {
        console.error(`Failed to convert ${typeof url === 'string' ? url : JSON.stringify(url)}:`, error);
        processedPages.push({
          url: typeof url === 'string' ? url : JSON.stringify(url),
          error: error.message,
          success: false
        });
      }
    }

    // Generate index
    if (options.onProgress) {
      options.onProgress({
        status: 'generating_index',
        websiteUrl: parentUrl,
        processedCount: processedPages.length,
        totalCount: processedPages.length,
        progress: 90
      });
    }

    const { files, indexContent } = generateOutputFiles(parentUrl, processedPages, hostname);

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
 * @private
 */
function generateOutputFiles(parentUrl, pages, hostname) {
  const successfulPages = pages.filter(p => p.success);
  const failedPages = pages.filter(p => !p.success);
  const timestamp = new Date().toISOString();

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

  // Create files array
  const files = [
    {
      name: 'index.md',
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
        name: `${filename}.md`,
        content: page.content,
        type: 'text'
      };
    })
  ];

  return { files, indexContent };
}
