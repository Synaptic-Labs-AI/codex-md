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
        const result = await convertUrlToMarkdown(url, options);
        processedPages.push({
          url,
          content: result.content,
          metadata: result.metadata,
          success: true
        });

        // Track section progress
        try {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          const section = pathParts[0] || 'main';
          
          if (options.onProgress) {
            options.onProgress({
              status: 'section',
              websiteUrl: parentUrl,
              section: section.charAt(0).toUpperCase() + section.slice(1),
              count: 1
            });
          }
        } catch (error) {
          console.error('Error extracting section:', error);
        }
      } catch (error) {
        console.error(`Failed to convert ${url}:`, error);
        processedPages.push({
          url,
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
        const name = page.url.split('/').pop().replace(/\.[^/.]+$/, '');
        return `- [[${name}|${name}]] - [Original](${page.url})`;
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
    ...successfulPages.map(page => ({
      name: `${page.url.split('/').pop().replace(/\.[^/.]+$/, '')}.md`,
      content: page.content,
      type: 'text'
    }))
  ];

  return { files, indexContent };
}
