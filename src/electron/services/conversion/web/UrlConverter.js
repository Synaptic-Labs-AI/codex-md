/**
 * UrlConverter.js
 * Handles conversion of web pages to markdown format in the Electron main process.
 * 
 * This converter:
 * - Fetches web pages using puppeteer
 * - Extracts content, metadata, and images
 * - Handles JavaScript-rendered content
 * - Generates markdown with structured content
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileStorageService.js: For temporary file management
 * - ParentUrlConverter.js: For multi-page site conversion
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const { URL } = require('url');
const BaseService = require('../../BaseService');

class UrlConverter extends BaseService {
    constructor(fileProcessor, fileStorage) {
        super();
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        this.supportedProtocols = ['http:', 'https:'];
        this.activeConversions = new Map();
    }

    /**
     * Set up IPC handlers for URL conversion
     */
    setupIpcHandlers() {
        this.registerHandler('convert:url', this.handleConvert.bind(this));
        this.registerHandler('convert:url:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:url:screenshot', this.handleScreenshot.bind(this));
        this.registerHandler('convert:url:cancel', this.handleCancel.bind(this));
    }

    /**
     * Handle URL conversion request
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
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('url_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                url,
                tempDir,
                window
            });

            // Notify client that conversion has started
            window.webContents.send('url:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, url, options).catch(error => {
                console.error(`[UrlConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[UrlConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[UrlConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle URL metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { url }) {
        try {
            const metadata = await this.fetchMetadata(url);
            return metadata;
        } catch (error) {
            console.error('[UrlConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle URL screenshot request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Screenshot request details
     */
    async handleScreenshot(event, { url, options = {} }) {
        try {
            const tempDir = await this.fileStorage.createTempDir('url_screenshot');
            const screenshotPath = path.join(tempDir, 'screenshot.png');
            
            await this.captureScreenshot(url, screenshotPath, options);
            
            // Read the screenshot as base64
            const screenshotData = await fs.readFile(screenshotPath, { encoding: 'base64' });
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            return {
                data: `data:image/png;base64,${screenshotData}`,
                url
            };
        } catch (error) {
            console.error('[UrlConverter] Failed to capture screenshot:', error);
            throw error;
        }
    }

    /**
     * Handle conversion cancellation request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Cancellation request details
     */
    async handleCancel(event, { conversionId }) {
        const conversion = this.activeConversions.get(conversionId);
        if (conversion) {
            conversion.status = 'cancelled';
            
            if (conversion.browser) {
                await conversion.browser.close();
            }
            
            if (conversion.window) {
                conversion.window.webContents.send('url:conversion-cancelled', { conversionId });
            }
            
            // Clean up temp directory
            if (conversion.tempDir) {
                await fs.remove(conversion.tempDir);
            }
            
            this.activeConversions.delete(conversionId);
        }
        return { success: true };
    }

    /**
     * Process URL conversion
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
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            
            conversion.browser = browser;
            
            // Fetch metadata
            this.updateConversionStatus(conversionId, 'fetching_metadata', { progress: 10 });
            const metadata = await this.fetchMetadata(url, browser);
            
            // Capture screenshot if requested
            let screenshot = null;
            if (options.includeScreenshot) {
                this.updateConversionStatus(conversionId, 'capturing_screenshot', { progress: 20 });
                const screenshotPath = path.join(tempDir, 'screenshot.png');
                await this.captureScreenshot(url, screenshotPath, options, browser);
                
                // Read screenshot as base64
                const screenshotData = await fs.readFile(screenshotPath, { encoding: 'base64' });
                screenshot = `data:image/png;base64,${screenshotData}`;
            }
            
            // Extract content
            this.updateConversionStatus(conversionId, 'extracting_content', { progress: 40 });
            const content = await this.extractContent(url, options, browser);
            
            // Process images if requested
            if (options.includeImages) {
                this.updateConversionStatus(conversionId, 'processing_images', { progress: 60 });
                await this.processImages(content, tempDir, url, browser);
            }
            
            // Generate markdown
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 80 });
            const markdown = this.generateMarkdown(metadata, content, screenshot, options);
            
            // Close browser
            await browser.close();
            conversion.browser = null;
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[UrlConverter] Conversion processing failed:', error);
            
            // Close browser if open
            if (browser) {
                await browser.close();
            }
            
            throw error;
        }
    }

    /**
     * Fetch metadata from URL
     * @param {string} url - URL to fetch
     * @param {puppeteer.Browser} [existingBrowser] - Existing browser instance
     * @returns {Promise<Object>} URL metadata
     */
    async fetchMetadata(url, existingBrowser = null) {
        let browser = existingBrowser;
        let shouldCloseBrowser = false;
        
        try {
            if (!browser) {
                browser = await puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                shouldCloseBrowser = true;
            }
            
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Extract metadata
            const metadata = await page.evaluate(() => {
                const getMetaContent = (name) => {
                    const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                    return element ? element.getAttribute('content') : null;
                };
                
                return {
                    title: document.title,
                    description: getMetaContent('description') || getMetaContent('og:description'),
                    keywords: getMetaContent('keywords'),
                    author: getMetaContent('author'),
                    ogTitle: getMetaContent('og:title'),
                    ogImage: getMetaContent('og:image'),
                    ogType: getMetaContent('og:type'),
                    ogUrl: getMetaContent('og:url'),
                    favicon: document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')?.href
                };
            });
            
            // Add URL information
            const parsedUrl = new URL(url);
            metadata.url = url;
            metadata.domain = parsedUrl.hostname;
            metadata.path = parsedUrl.pathname;
            
            await page.close();
            
            if (shouldCloseBrowser) {
                await browser.close();
            }
            
            return metadata;
        } catch (error) {
            console.error('[UrlConverter] Failed to fetch metadata:', error);
            
            if (shouldCloseBrowser && browser) {
                await browser.close();
            }
            
            throw error;
        }
    }

    /**
     * Capture screenshot of URL
     * @param {string} url - URL to capture
     * @param {string} outputPath - Output path for screenshot
     * @param {Object} options - Screenshot options
     * @param {puppeteer.Browser} [existingBrowser] - Existing browser instance
     * @returns {Promise<void>}
     */
    async captureScreenshot(url, outputPath, options = {}, existingBrowser = null) {
        let browser = existingBrowser;
        let shouldCloseBrowser = false;
        
        try {
            if (!browser) {
                browser = await puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                });
                shouldCloseBrowser = true;
            }
            
            const page = await browser.newPage();
            
            // Set viewport size
            const width = options.width || 1280;
            const height = options.height || 800;
            await page.setViewport({ width, height });
            
            // Navigate to URL
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Wait for additional time if specified
            if (options.waitTime) {
                await page.waitForTimeout(options.waitTime);
            }
            
            // Capture screenshot
            await page.screenshot({
                path: outputPath,
                fullPage: options.fullPage || false,
                type: 'png'
            });
            
            await page.close();
            
            if (shouldCloseBrowser) {
                await browser.close();
            }
        } catch (error) {
            console.error('[UrlConverter] Failed to capture screenshot:', error);
            
            if (shouldCloseBrowser && browser) {
                await browser.close();
            }
            
            throw error;
        }
    }

    /**
     * Extract content from URL
     * @param {string} url - URL to extract content from
     * @param {Object} options - Extraction options
     * @param {puppeteer.Browser} browser - Browser instance
     * @returns {Promise<Object>} Extracted content
     */
    async extractContent(url, options, browser) {
        try {
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Wait for additional time if specified
            if (options.waitTime) {
                await page.waitForTimeout(options.waitTime);
            }
            
            // Get page HTML
            const html = await page.content();
            
            // Extract content using cheerio
            const $ = cheerio.load(html);
            
            // Remove unwanted elements
            $('script, style, iframe, noscript').remove();
            
            // Extract main content
            let mainContent = '';
            const mainSelectors = [
                'main',
                'article',
                '#content',
                '.content',
                '.main',
                '.article',
                '.post',
                '.post-content'
            ];
            
            // Try to find main content using common selectors
            for (const selector of mainSelectors) {
                if ($(selector).length > 0) {
                    mainContent = $(selector).html();
                    break;
                }
            }
            
            // If no main content found, use body
            if (!mainContent) {
                mainContent = $('body').html();
            }
            
            // Extract images
            const images = [];
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                const alt = $(el).attr('alt') || '';
                
                if (src) {
                    // Resolve relative URLs
                    const absoluteSrc = new URL(src, url).href;
                    
                    images.push({
                        src: absoluteSrc,
                        alt,
                        filename: path.basename(absoluteSrc)
                    });
                }
            });
            
            // Extract links
            const links = [];
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                const text = $(el).text().trim();
                
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    // Resolve relative URLs
                    const absoluteHref = new URL(href, url).href;
                    
                    links.push({
                        href: absoluteHref,
                        text: text || absoluteHref
                    });
                }
            });
            
            await page.close();
            
            return {
                html: mainContent,
                images,
                links
            };
        } catch (error) {
            console.error('[UrlConverter] Failed to extract content:', error);
            throw error;
        }
    }

    /**
     * Process images from content
     * @param {Object} content - Extracted content
     * @param {string} tempDir - Temporary directory
     * @param {string} baseUrl - Base URL for resolving relative paths
     * @param {puppeteer.Browser} browser - Browser instance
     * @returns {Promise<void>}
     */
    async processImages(content, tempDir, baseUrl, browser) {
        try {
            const imagesDir = path.join(tempDir, 'images');
            await fs.ensureDir(imagesDir);
            
            // Download images
            for (const image of content.images) {
                try {
                    const page = await browser.newPage();
                    
                    // Set up response interception
                    await page.setRequestInterception(true);
                    
                    page.on('request', request => {
                        if (request.url() === image.src) {
                            request.continue();
                        } else {
                            request.abort();
                        }
                    });
                    
                    const response = await page.goto(image.src, { timeout: 10000 });
                    
                    if (response.ok()) {
                        const buffer = await response.buffer();
                        const imagePath = path.join(imagesDir, image.filename);
                        await fs.writeFile(imagePath, buffer);
                        
                        // Update image with local path
                        image.localPath = imagePath;
                        image.data = `data:${response.headers()['content-type']};base64,${buffer.toString('base64')}`;
                    }
                    
                    await page.close();
                } catch (error) {
                    console.error(`[UrlConverter] Failed to download image: ${image.src}`, error);
                    // Continue with other images
                }
            }
        } catch (error) {
            console.error('[UrlConverter] Failed to process images:', error);
            throw error;
        }
    }

    /**
     * Generate markdown from URL content
     * @param {Object} metadata - URL metadata
     * @param {Object} content - Extracted content
     * @param {string} screenshot - Screenshot data URL
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    generateMarkdown(metadata, content, screenshot, options) {
        const markdown = [];
        
        // Add title
        if (options.title) {
            markdown.push(`# ${options.title}`);
        } else if (metadata.title) {
            markdown.push(`# ${metadata.title}`);
        } else {
            markdown.push(`# Web Page: ${metadata.url}`);
        }
        
        markdown.push('');
        
        // Add metadata
        markdown.push('## Page Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| URL | [${metadata.url}](${metadata.url}) |`);
        markdown.push(`| Domain | ${metadata.domain} |`);
        
        if (metadata.title) markdown.push(`| Title | ${metadata.title} |`);
        if (metadata.description) markdown.push(`| Description | ${metadata.description} |`);
        if (metadata.author) markdown.push(`| Author | ${metadata.author} |`);
        if (metadata.keywords) markdown.push(`| Keywords | ${metadata.keywords} |`);
        
        markdown.push('');
        
        // Add screenshot if available
        if (screenshot) {
            markdown.push('## Screenshot');
            markdown.push('');
            markdown.push(`![Screenshot of ${metadata.title || metadata.url}](${screenshot})`);
            markdown.push('');
        }
        
        // Add content
        markdown.push('## Content');
        markdown.push('');
        
        // Convert HTML to markdown
        const TurndownService = require('turndown');
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*'
        });
        
        // Customize turndown
        turndownService.addRule('images', {
            filter: 'img',
            replacement: function(content, node) {
                const alt = node.alt || '';
                const src = node.getAttribute('src') || '';
                
                // Find image in content.images
                const image = content.images?.find(img => img.src === src || img.src.endsWith(src));
                
                // Use data URL if available
                const imageUrl = image?.data || src;
                
                return `![${alt}](${imageUrl})`;
            }
        });
        
        const markdownContent = turndownService.turndown(content.html);
        markdown.push(markdownContent);
        
        // Add links section if requested
        if (options.includeLinks && content.links && content.links.length > 0) {
            markdown.push('');
            markdown.push('## Links');
            markdown.push('');
            
            content.links.forEach(link => {
                markdown.push(`- [${link.text}](${link.href})`);
            });
        }
        
        return markdown.join('\n');
    }

    /**
     * Generate unique conversion ID
     * @returns {string} Unique conversion ID
     */
    generateConversionId() {
        return `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Update conversion status and notify renderer
     * @param {string} conversionId - Conversion identifier
     * @param {string} status - New status
     * @param {Object} details - Additional details
     */
    updateConversionStatus(conversionId, status, details = {}) {
        const conversion = this.activeConversions.get(conversionId);
        if (conversion) {
            conversion.status = status;
            Object.assign(conversion, details);
            
            if (conversion.window) {
                conversion.window.webContents.send('url:conversion-progress', {
                    conversionId,
                    status,
                    ...details
                });
            }
        }
    }

    /**
     * Check if this converter supports the given URL
     * @param {string} url - URL to check
     * @returns {boolean} True if supported
     */
    supportsUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return this.supportedProtocols.includes(parsedUrl.protocol);
        } catch (error) {
            return false;
        }
    }

    /**
     * Get converter information
     * @returns {Object} Converter details
     */
    getInfo() {
        return {
            name: 'URL Converter',
            protocols: this.supportedProtocols,
            description: 'Converts web pages to markdown',
            options: {
                title: 'Optional page title',
                includeScreenshot: 'Whether to include page screenshot (default: false)',
                includeImages: 'Whether to include images (default: true)',
                includeLinks: 'Whether to include links section (default: true)',
                waitTime: 'Additional time to wait for page load in ms'
            }
        };
    }
}

module.exports = UrlConverter;
