/**
 * ParentUrlConverter.js
 * Handles conversion of multi-page websites to markdown format in the Electron main process.
 * 
 * This converter:
 * - Extends UrlConverter with site crawling capabilities
 * - Discovers and processes linked pages
 * - Creates a structured site map
 * - Generates comprehensive markdown with multiple pages
 * 
 * Related Files:
 * - UrlConverter.js: Parent class for single page conversion
 * - FileStorageService.js: For temporary file management
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const { URL } = require('url');
const UrlConverter = require('./UrlConverter');

class ParentUrlConverter extends UrlConverter {
    constructor(fileProcessor, fileStorage) {
        super(fileProcessor, fileStorage);
        this.name = 'Parent URL Converter';
        this.description = 'Converts multi-page websites to markdown';
    }

    /**
     * Set up IPC handlers for parent URL conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:parent-url', this.handleConvert.bind(this));
        this.registerHandler('convert:parent-url:sitemap', this.handleGetSitemap.bind(this));
        this.registerHandler('convert:parent-url:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle parent URL conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { url, options = {} }) {
        try {
            // Validate URL
            const parsedUrl = new URL(url);
            if (!this.supportedProtocols.includes(parsedUrl.protocol)) {
                throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
            }
            
            const conversionId = this.generateConversionId();
            const window = event?.sender?.getOwnerBrowserWindow?.() || null;
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('parent_url_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                url,
                tempDir,
                window,
                processedUrls: new Set(),
                pages: []
            });

            // Notify client that conversion has started (only if we have a valid window)
            if (window && window.webContents) {
                window.webContents.send('parent-url:conversion-started', { conversionId });
            }

            // Start conversion process
            this.processConversion(conversionId, url, options).catch(error => {
                console.error(`[ParentUrlConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[ParentUrlConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[ParentUrlConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle sitemap request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Sitemap request details
     */
    async handleGetSitemap(event, { url, options = {} }) {
        try {
            const browser = await this.launchBrowser();
            const sitemap = await this.discoverSitemap(url, options, browser);
            await browser.close();
            return sitemap;
        } catch (error) {
            console.error('[ParentUrlConverter] Failed to get sitemap:', error);
            throw error;
        }
    }

    /**
     * Process parent URL conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} url - URL to convert
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, url, options) {
        let browser = null;
        
        try {
            const conversion = this.activeConversions.get(conversionId);
            if (!conversion) {
                throw new Error('Conversion not found');
            }
            
            const tempDir = conversion.tempDir;
            
            // Launch browser
            this.updateConversionStatus(conversionId, 'launching_browser', { progress: 5 });
            browser = await this.launchBrowser();
            conversion.browser = browser;
            
            // Discover sitemap
            this.updateConversionStatus(conversionId, 'discovering_sitemap', { progress: 10 });
            const sitemap = await this.discoverSitemap(url, options, browser);
            
            // Process each page
            const maxPages = options.maxPages || sitemap.pages.length;
            const pagesToProcess = sitemap.pages.slice(0, maxPages);
            
            this.updateConversionStatus(conversionId, 'processing_pages', {
                progress: 20,
                total: pagesToProcess.length,
                processed: 0
            });
            
            for (let i = 0; i < pagesToProcess.length; i++) {
                const page = pagesToProcess[i];
                
                // Skip if already processed
                if (conversion.processedUrls.has(page.url)) {
                    continue;
                }
                
                // Process page
                this.updateConversionStatus(conversionId, 'processing_page', {
                    progress: 20 + Math.floor((i / pagesToProcess.length) * 60),
                    currentPage: page.url,
                    processed: i,
                    total: pagesToProcess.length
                });
                
                // Convert page using parent UrlConverter's methods
                const pageContent = await this.processPage(page.url, options, browser, tempDir);
                
                // Add to processed pages
                conversion.processedUrls.add(page.url);
                conversion.pages.push({
                    url: page.url,
                    title: page.title,
                    content: pageContent
                });
            }
            
            // Generate markdown files based on save mode
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 90 });
            
            const saveMode = options.websiteScraping?.saveMode || 'combined';
            console.log(`[ParentUrlConverter] Using save mode: ${saveMode}`);
            
            let result;
            if (saveMode === 'separate') {
                // Generate separate files
                result = await this.generateSeparateFiles(sitemap, conversion.pages, options, tempDir);
            } else {
                // Generate combined markdown (default behavior)
                result = this.generateCombinedMarkdown(sitemap, conversion.pages, options);
            }
            
            // Close browser
            await browser.close();
            conversion.browser = null;
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: result
            });
            
            return result;
        } catch (error) {
            console.error('[ParentUrlConverter] Conversion processing failed:', error);
            
            // Close browser if open
            if (browser) {
                await browser.close();
            }
            
            throw error;
        }
    }

    /**
     * Launch browser instance
     * @returns {Promise<puppeteer.Browser>} Browser instance
     */
    async launchBrowser() {
        const puppeteer = require('puppeteer');
        return await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    }

    /**
     * Discover sitemap for URL
     * @param {string} url - URL to discover
     * @param {Object} options - Discovery options
     * @param {puppeteer.Browser} browser - Browser instance
     * @returns {Promise<Object>} Sitemap
     */
    async discoverSitemap(url, options, browser) {
        try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Get base URL and domain
            const baseUrl = await page.evaluate(() => document.baseURI);
            const parsedUrl = new URL(baseUrl);
            const domain = parsedUrl.hostname;
            
            // Get site metadata
            const metadata = await this.fetchMetadata(url, browser);
            
            // Find links
            const maxDepth = options.maxDepth || 1;
            const maxPages = options.maxPages || 10;
            
            const discoveredPages = new Map();
            discoveredPages.set(url, {
                url,
                title: metadata.title,
                depth: 0,
                links: []
            });
            
            // Breadth-first search for links
            const queue = [{ url, depth: 0 }];
            
            while (queue.length > 0 && discoveredPages.size < maxPages) {
                const { url: currentUrl, depth } = queue.shift();
                
                // Skip if already at max depth
                if (depth >= maxDepth) {
                    continue;
                }
                
                // Get links from page
                const links = await this.getPageLinks(currentUrl, domain, browser);
                
                // Update current page links
                const currentPage = discoveredPages.get(currentUrl);
                if (currentPage) {
                    currentPage.links = links;
                }
                
                // Add new links to queue
                for (const link of links) {
                    if (!discoveredPages.has(link.url) && discoveredPages.size < maxPages) {
                        // Get page title
                        let title = link.text;
                        try {
                            const linkPage = await browser.newPage();
                            await linkPage.goto(link.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
                            title = await linkPage.title();
                            await linkPage.close();
                        } catch (error) {
                            console.error(`[ParentUrlConverter] Failed to get title for ${link.url}:`, error);
                        }
                        
                        // Add to discovered pages
                        discoveredPages.set(link.url, {
                            url: link.url,
                            title: title || link.text,
                            depth: depth + 1,
                            links: []
                        });
                        
                        // Add to queue
                        queue.push({ url: link.url, depth: depth + 1 });
                    }
                }
            }
            
            // Build sitemap
            const sitemap = {
                rootUrl: url,
                domain,
                title: metadata.title,
                pages: Array.from(discoveredPages.values())
            };
            
            return sitemap;
        } catch (error) {
            console.error('[ParentUrlConverter] Failed to discover sitemap:', error);
            throw error;
        }
    }

    /**
     * Get links from page
     * @param {string} url - URL to get links from
     * @param {string} domain - Domain to filter links
     * @param {puppeteer.Browser} browser - Browser instance
     * @returns {Promise<Array>} Array of links
     */
    async getPageLinks(url, domain, browser) {
        try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            
            // Extract links
            const links = await page.evaluate((domain) => {
                const links = [];
                const anchors = document.querySelectorAll('a[href]');
                
                for (const anchor of anchors) {
                    const href = anchor.href;
                    const text = anchor.textContent.trim();
                    
                    // Skip empty, hash, and javascript links
                    if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
                        continue;
                    }
                    
                    try {
                        const url = new URL(href);
                        
                        // Only include links from same domain
                        if (url.hostname === domain) {
                            links.push({
                                url: href,
                                text: text || href
                            });
                        }
                    } catch (error) {
                        // Skip invalid URLs
                    }
                }
                
                return links;
            }, domain);
            
            await page.close();
            
            // Remove duplicates
            const uniqueLinks = [];
            const seenUrls = new Set();
            
            for (const link of links) {
                // Normalize URL by removing trailing slash and hash
                const normalizedUrl = link.url.replace(/#.*$/, '').replace(/\/$/, '');
                
                if (!seenUrls.has(normalizedUrl)) {
                    seenUrls.add(normalizedUrl);
                    uniqueLinks.push(link);
                }
            }
            
            return uniqueLinks;
        } catch (error) {
            console.error(`[ParentUrlConverter] Failed to get links from ${url}:`, error);
            return [];
        }
    }

    /**
     * Process a single page
     * @param {string} url - URL to process
     * @param {Object} options - Processing options
     * @param {puppeteer.Browser} browser - Browser instance
     * @param {string} tempDir - Temporary directory
     * @returns {Promise<string>} Markdown content
     */
    async processPage(url, options, browser, tempDir) {
        try {
            // Extract content
            const content = await this.extractContent(url, options, browser);
            
            // Process images if requested
            if (options.includeImages) {
                await this.processImages(content, tempDir, url, browser);
            }
            
            // Capture screenshot if requested
            let screenshot = null;
            if (options.includeScreenshot) {
                const screenshotPath = path.join(tempDir, `screenshot_${Date.now()}.png`);
                await this.captureScreenshot(url, screenshotPath, options, browser);
                
                // Read screenshot as base64
                const screenshotData = await fs.readFile(screenshotPath, { encoding: 'base64' });
                screenshot = `data:image/png;base64,${screenshotData}`;
            }
            
            // Get metadata
            const metadata = await this.fetchMetadata(url, browser);
            
            // Generate markdown
            return this.generateMarkdown(metadata, content, screenshot, options);
        } catch (error) {
            console.error(`[ParentUrlConverter] Failed to process page ${url}:`, error);
            return `# Error Processing Page: ${url}\n\nFailed to process this page: ${error.message}`;
        }
    }

    /**
     * Generate separate markdown files for each page
     * @param {Object} sitemap - Sitemap
     * @param {Array} pages - Processed pages
     * @param {Object} options - Conversion options
     * @param {string} tempDir - Temporary directory for file operations
     * @returns {Promise<Object>} Result with multiple files information
     */
    async generateSeparateFiles(sitemap, pages, options, tempDir) {
        try {
            console.log(`[ParentUrlConverter] Generating ${pages.length} separate files`);
            
            const outputDir = options.outputDir;
            const siteDomain = new URL(sitemap.rootUrl).hostname;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const baseName = `${siteDomain}_${timestamp}`;
            
            // Create a subdirectory for the website files
            const websiteDir = path.join(outputDir, baseName);
            await fs.ensureDir(websiteDir);
            
            const generatedFiles = [];
            
            // Generate individual page files
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                
                // Create a safe filename from the page title or URL
                let filename = page.title || new URL(page.url).pathname;
                filename = filename.replace(/[^a-zA-Z0-9\-_]/g, '_');
                filename = filename.replace(/_+/g, '_').replace(/^_|_$/g, '');
                filename = filename || `page_${i + 1}`;
                
                // Ensure filename is not too long
                if (filename.length > 50) {
                    filename = filename.substring(0, 50);
                }
                
                const filepath = path.join(websiteDir, `${filename}.md`);
                
                // Generate markdown for this page
                const pageMarkdown = this.generateSinglePageMarkdown(page, sitemap, options);
                
                // Write file
                await fs.writeFile(filepath, pageMarkdown, 'utf8');
                
                generatedFiles.push({
                    title: page.title,
                    url: page.url,
                    filename: `${filename}.md`,
                    filepath: filepath
                });
                
                console.log(`[ParentUrlConverter] Generated file: ${filename}.md`);
            }
            
            // Generate an index file with links to all pages
            const indexMarkdown = this.generateIndexMarkdown(sitemap, generatedFiles, options);
            const indexPath = path.join(websiteDir, 'index.md');
            await fs.writeFile(indexPath, indexMarkdown, 'utf8');
            
            console.log(`[ParentUrlConverter] Generated index file: index.md`);
            
            // Return information about the generated files
            return {
                type: 'multiple_files',
                outputDirectory: websiteDir,
                indexFile: indexPath,
                files: generatedFiles,
                totalFiles: generatedFiles.length + 1, // +1 for index
                summary: `Generated ${generatedFiles.length} page files + 1 index file in ${baseName}/`
            };
        } catch (error) {
            console.error('[ParentUrlConverter] Error generating separate files:', error);
            throw error;
        }
    }

    /**
     * Generate markdown for a single page
     * @param {Object} page - Page data
     * @param {Object} sitemap - Sitemap information
     * @param {Object} options - Conversion options
     * @returns {string} Single page markdown
     */
    generateSinglePageMarkdown(page, sitemap, options) {
        const markdown = [];
        
        // Add page title
        markdown.push(`# ${page.title || page.url}`);
        markdown.push('');
        
        // Add page metadata
        markdown.push('## Page Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| URL | [${page.url}](${page.url}) |`);
        markdown.push(`| Title | ${page.title || 'N/A'} |`);
        markdown.push(`| Site | [${sitemap.domain}](${sitemap.rootUrl}) |`);
        markdown.push(`| Generated | ${new Date().toISOString()} |`);
        markdown.push('');
        
        // Add content
        markdown.push('## Content');
        markdown.push('');
        markdown.push(page.content);
        
        return markdown.join('\n');
    }

    /**
     * Generate index markdown with links to all pages
     * @param {Object} sitemap - Sitemap information
     * @param {Array} files - Generated files information
     * @param {Object} options - Conversion options
     * @returns {string} Index markdown
     */
    generateIndexMarkdown(sitemap, files, options) {
        const markdown = [];
        
        // Add title
        if (options.title) {
            markdown.push(`# ${options.title}`);
        } else {
            markdown.push(`# ${sitemap.title || 'Website Conversion'}`);
        }
        
        markdown.push('');
        
        // Add site information
        markdown.push('## Site Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| Root URL | [${sitemap.rootUrl}](${sitemap.rootUrl}) |`);
        markdown.push(`| Domain | ${sitemap.domain} |`);
        markdown.push(`| Pages Processed | ${files.length} |`);
        markdown.push(`| Generated | ${new Date().toISOString()} |`);
        
        markdown.push('');
        
        // Add list of generated files
        markdown.push('## Generated Files');
        markdown.push('');
        
        files.forEach((file, index) => {
            markdown.push(`${index + 1}. [${file.title || file.url}](./${file.filename})`);
            markdown.push(`   - URL: ${file.url}`);
            markdown.push(`   - File: ${file.filename}`);
            markdown.push('');
        });
        
        // Add sitemap visualization if requested
        if (options.includeSitemap) {
            markdown.push('## Site Structure');
            markdown.push('');
            markdown.push('```mermaid');
            markdown.push('graph TD');
            
            // Add root node
            markdown.push(`  root["${sitemap.title || sitemap.rootUrl}"]`);
            
            // Add page nodes and links
            sitemap.pages.forEach((page, index) => {
                if (page.url !== sitemap.rootUrl) {
                    markdown.push(`  page${index}["${page.title || page.url}"]`);
                    
                    // Find parent page
                    let parentFound = false;
                    for (const potentialParent of sitemap.pages) {
                        if (potentialParent.links.some(link => link.url === page.url)) {
                            const parentIndex = sitemap.pages.findIndex(p => p.url === potentialParent.url);
                            if (potentialParent.url === sitemap.rootUrl) {
                                markdown.push(`  root --> page${index}`);
                            } else {
                                markdown.push(`  page${parentIndex} --> page${index}`);
                            }
                            parentFound = true;
                            break;
                        }
                    }
                    
                    // If no parent found, connect to root
                    if (!parentFound) {
                        markdown.push(`  root --> page${index}`);
                    }
                }
            });
            
            markdown.push('```');
            markdown.push('');
        }
        
        return markdown.join('\n');
    }

    /**
     * Generate combined markdown from multiple pages
     * @param {Object} sitemap - Sitemap
     * @param {Array} pages - Processed pages
     * @param {Object} options - Conversion options
     * @returns {string} Combined markdown
     */
    generateCombinedMarkdown(sitemap, pages, options) {
        const markdown = [];
        
        // Add title
        if (options.title) {
            markdown.push(`# ${options.title}`);
        } else {
            markdown.push(`# ${sitemap.title || 'Website Conversion'}`);
        }
        
        markdown.push('');
        
        // Add site information
        markdown.push('## Site Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| Root URL | [${sitemap.rootUrl}](${sitemap.rootUrl}) |`);
        markdown.push(`| Domain | ${sitemap.domain} |`);
        markdown.push(`| Pages Processed | ${pages.length} |`);
        
        markdown.push('');
        
        // Add table of contents
        markdown.push('## Table of Contents');
        markdown.push('');
        
        pages.forEach((page, index) => {
            markdown.push(`${index + 1}. [${page.title || page.url}](#page-${index + 1})`);
        });
        
        markdown.push('');
        
        // Add each page
        pages.forEach((page, index) => {
            markdown.push(`<a id="page-${index + 1}"></a>`);
            markdown.push(`## Page ${index + 1}: ${page.title || page.url}`);
            markdown.push('');
            markdown.push(`URL: [${page.url}](${page.url})`);
            markdown.push('');
            markdown.push('---');
            markdown.push('');
            markdown.push(page.content);
            markdown.push('');
            markdown.push('---');
            markdown.push('');
        });
        
        // Add sitemap visualization if requested
        if (options.includeSitemap) {
            markdown.push('## Site Structure');
            markdown.push('');
            markdown.push('```mermaid');
            markdown.push('graph TD');
            
            // Add root node
            markdown.push(`  root["${sitemap.title || sitemap.rootUrl}"]`);
            
            // Add page nodes and links
            sitemap.pages.forEach((page, index) => {
                if (page.url !== sitemap.rootUrl) {
                    markdown.push(`  page${index}["${page.title || page.url}"]`);
                    
                    // Find parent page
                    let parentFound = false;
                    for (const potentialParent of sitemap.pages) {
                        if (potentialParent.links.some(link => link.url === page.url)) {
                            const parentIndex = sitemap.pages.findIndex(p => p.url === potentialParent.url);
                            if (potentialParent.url === sitemap.rootUrl) {
                                markdown.push(`  root --> page${index}`);
                            } else {
                                markdown.push(`  page${parentIndex} --> page${index}`);
                            }
                            parentFound = true;
                            break;
                        }
                    }
                    
                    // If no parent found, connect to root
                    if (!parentFound) {
                        markdown.push(`  root --> page${index}`);
                    }
                }
            });
            
            markdown.push('```');
            markdown.push('');
        }
        
        return markdown.join('\n');
    }

    /**
     * Get converter information
     * @returns {Object} Converter details
     */
    getInfo() {
        return {
            name: this.name,
            protocols: this.supportedProtocols,
            description: this.description,
            options: {
                title: 'Optional site title',
                maxDepth: 'Maximum crawl depth (default: 1)',
                maxPages: 'Maximum pages to process (default: 10)',
                includeScreenshot: 'Whether to include page screenshots (default: false)',
                includeImages: 'Whether to include images (default: true)',
                includeLinks: 'Whether to include links section (default: true)',
                includeSitemap: 'Whether to include site structure visualization (default: true)',
                waitTime: 'Additional time to wait for page load in ms'
            }
        };
    }
}

module.exports = ParentUrlConverter;
