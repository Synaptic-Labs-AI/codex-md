/**
 * ConverterRegistry.js
 * 
 * Central registry for all file type converters in the Electron main process.
 * Provides a unified interface for accessing converters based on file type.
 * 
 * This file was created as part of the consolidation process to centralize
 * all converter functionality in the Electron main process.
 * 
 * Related files:
 * - src/electron/converters/UnifiedConverterFactory.js: Uses this registry for conversions
 * - src/electron/services/ElectronConversionService.js: References this registry
 * - src/electron/services/conversion/data/*.js: Data converters
 * - src/electron/services/conversion/document/*.js: Document converters
 * - src/electron/services/conversion/multimedia/*.js: Multimedia converters
 * - src/electron/services/conversion/web/*.js: Web converters
 */

const fs = require('fs-extra');
const path = require('path');
const { ipcMain } = require('electron');

/**
 * Registry for all file type converters
 */
function ConverterRegistry() {
    this.converters = {};
    this.setupConverters();
}

/**
 * Register a converter for a specific file type
 * @param {string} type - File type (extension without dot)
 * @param {Object} converter - Converter implementation
 */
ConverterRegistry.prototype.register = function(type, converter) {
    this.converters[type] = converter;
    console.log(`Registered converter for ${type}`);
};

/**
 * Get converter by file extension
 * @param {string} extension - File extension (with or without dot)
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByExtension = function(extension) {
    // Normalize extension (remove dot, lowercase)
    const normalizedExt = extension.toLowerCase().replace(/^\./, '');
    return this.converters[normalizedExt] || null;
};

/**
 * Get converter by MIME type
 * @param {string} mimeType - MIME type
 * @returns {Object|null} Converter or null if not found
 */
ConverterRegistry.prototype.getConverterByMimeType = function(mimeType) {
    // Find converter that supports this MIME type
    for (const [type, converter] of Object.entries(this.converters)) {
        if (converter.config && 
            converter.config.mimeTypes && 
            converter.config.mimeTypes.includes(mimeType)) {
            return converter;
        }
    }
    return null;
};

/**
 * Convert content to markdown using appropriate converter
 * @param {string} type - File type
 * @param {Buffer|string} content - Content to convert
 * @param {Object} options - Conversion options
 * @returns {Promise<Object>} Conversion result
 */
ConverterRegistry.prototype.convertToMarkdown = async function(type, content, options) {
    options = options || {};
    const converter = this.getConverterByExtension(type);
    if (!converter) {
        throw new Error(`No converter found for type: ${type}`);
    }
    
    return await converter.convert(content, options.name || 'file', options.apiKey, options);
};

/**
 * Setup all available converters
 */
ConverterRegistry.prototype.setupConverters = function() {
    try {
        // Import converters from the new location
        const CsvConverter = require('./data/CsvConverter');
        const XlsxConverter = require('./data/XlsxConverter');
        const AudioConverter = require('./multimedia/AudioConverter');
        const VideoConverter = require('./multimedia/VideoConverter');
        const PdfFactory = require('./document/PdfConverterFactory');
        const DocxConverter = require('./document/DocxConverter');
        const UrlConverter = require('./web/UrlConverter');
        const ParentUrlConverter = require('./web/ParentUrlConverter');

        // Create instances of converter classes
        const csvConverterInstance = new CsvConverter();
        const xlsxConverterInstance = new XlsxConverter();
        const audioConverterInstance = new AudioConverter();
        const videoConverterInstance = new VideoConverter();
        const pdfConverterFactory = new PdfFactory();
        const docxConverterInstance = new DocxConverter();
        
        // Create file service mocks for URL converters
        const fileProcessorMock = {
            handleFileRead: async (_, options) => {
                return { content: options.content || '' };
            }
        };
        const fileStorageMock = {
            createTempDir: async (prefix) => {
                return path.join(require('os').tmpdir(), `${prefix}_${Date.now()}`);
            }
        };
        
        // Instantiate URL converters with necessary dependencies
        const urlConverterInstance = new UrlConverter(fileProcessorMock, fileStorageMock);
        const parentUrlConverterInstance = new ParentUrlConverter(fileProcessorMock, fileStorageMock);

        // Create standardized adapter for DOCX converter using the actual implementation
        this.register('docx', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[DocxAdapter] Converting DOCX file: ${name}`);
                    
                    // Ensure content is a Buffer
                    if (!Buffer.isBuffer(content)) {
                        throw new Error('DOCX content must be a Buffer');
                    }
                    
                    // Use the actual DocxConverter implementation
                    const result = await docxConverterInstance.convertToMarkdown(content, {
                        ...options,
                        fileName: name,
                        apiKey
                    });
                    
                    // Ensure we have content
                    if (!result || typeof result !== 'string' || result.trim() === '') {
                        throw new Error('DOCX conversion produced empty content');
                    }
                    
                    return {
                        success: true,
                        content: result,
                        name: name,
                        type: 'docx'
                    };
                } catch (error) {
                    console.error(`[DocxAdapter] Error converting DOCX: ${error.message}`);
                    throw new Error(`DOCX conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'DOCX Converter',
                extensions: ['.docx', '.doc'],
                mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });
        
        // Create standardized adapter for the CSV converter
        this.register('csv', {
            convert: async (content, name, apiKey, options) => {
                return await csvConverterInstance.convertToMarkdown(content.toString(), {
                    ...options,
                    name
                });
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'CSV Converter',
                extensions: ['.csv'],
                mimeTypes: ['text/csv'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });

        // Create standardized adapter for the XLSX converter
        this.register('xlsx', {
            convert: async (content, name, apiKey, options) => {
                return await xlsxConverterInstance.convertToMarkdown(content, {
                    ...options,
                    name
                });
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'Excel Converter',
                extensions: ['.xlsx', '.xls'],
                mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });

        // Create standardized adapter for audio converters
        const audioAdapter = {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[AudioAdapter] Converting audio file: ${name}`);
                    
                    // Throw an error to indicate the converter is not properly implemented
                    throw new Error('Audio converter implementation is missing or not functioning correctly');
                } catch (error) {
                    console.error(`[AudioAdapter] Error converting audio: ${error.message}`);
                    throw new Error(`Audio conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'Audio Converter',
                extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.mpga'],
                mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        };
        
        this.register('mp3', audioAdapter);
        this.register('wav', audioAdapter);

        // Create standardized adapter for video converter
        this.register('mp4', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[VideoAdapter] Converting video file: ${name}`);
                    
                    // Throw an error to indicate the converter is not properly implemented
                    throw new Error('Video converter implementation is missing or not functioning correctly');
                } catch (error) {
                    console.error(`[VideoAdapter] Error converting video: ${error.message}`);
                    throw new Error(`Video conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'Video Converter',
                extensions: ['.mp4', '.webm', '.mov', '.avi'],
                mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'],
                maxSize: 500 * 1024 * 1024 // 500MB
            }
        });
        
        // Register the PDF factory adapter with proper implementation
        this.register('pdf', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log("[PdfAdapter] Converting PDF document");
                    
                    // Throw an error to indicate the converter is not properly implemented
                    throw new Error('PDF converter implementation is missing or not functioning correctly');
                } catch (error) {
                    console.error(`[PdfAdapter] Error converting PDF: ${error.message}`);
                    throw new Error(`PDF conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'PDF Converter',
                extensions: ['.pdf'],
                mimeTypes: ['application/pdf'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });

        // Create standardized adapter for URL converter using the actual implementation
        this.register('url', {
            convert: async (content, name, apiKey, options) => {
                // URL converter expects the content to be the URL string
                try {
                    console.log(`[UrlAdapter] Converting URL: ${content}`);
                    
                    // Create temporary directory for the conversion
                    const tempDir = await fileStorageMock.createTempDir('url_conversion');
                    
                    // Launch a browser instance for the conversion
                    const puppeteer = require('puppeteer');
                    const browser = await puppeteer.launch({
                        headless: 'new',
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    
                    try {
                        // Fetch metadata
                        const metadata = await urlConverterInstance.fetchMetadata(content, browser);
                        
                        // Extract content
                        const extractedContent = await urlConverterInstance.extractContent(content, options, browser);
                        
                        // Process images if requested
                        if (options.includeImages) {
                            await urlConverterInstance.processImages(extractedContent, tempDir, content, browser);
                        }
                        
                        // Generate markdown
                        const markdown = urlConverterInstance.generateMarkdown(metadata, extractedContent, null, options);
                        
                        // Close browser
                        await browser.close();
                        
                        // Clean up temporary directory
                        await fs.remove(tempDir);
                        
                        return {
                            success: true,
                            content: markdown,
                            name: name,
                            type: 'url'
                        };
                    } catch (error) {
                        // Close browser on error
                        await browser.close();
                        
                        // Clean up temporary directory
                        await fs.remove(tempDir);
                        
                        // Re-throw error
                        throw error;
                    }
                } catch (error) {
                    console.error(`[UrlAdapter] Error converting URL: ${error.message}`);
                    throw new Error(`URL conversion failed: ${error.message}`);
                }
            },
            validate: (content) => typeof content === 'string' && content.length > 0,
            config: {
                name: 'URL Converter',
                extensions: ['.url', '.html', '.htm'],
                mimeTypes: ['text/html', 'application/x-url'],
                maxSize: 10 * 1024 * 1024 // 10MB
            }
        });

        // Create standardized adapter for ParentURL converter using the actual implementation
        this.register('parenturl', {
            convert: async (content, name, apiKey, options) => {
                // For URL converters, content is the URL string itself
                try {
                    console.log(`[ParentUrlAdapter] Converting site: ${content}`);
                    
                    // Create temporary directory for the conversion
                    const tempDir = await fileStorageMock.createTempDir('parent_url_conversion');
                    
                    // Launch a browser instance for the conversion
                    const puppeteer = require('puppeteer');
                    const browser = await puppeteer.launch({
                        headless: 'new',
                        args: ['--no-sandbox', '--disable-setuid-sandbox']
                    });
                    
                    try {
                        // Discover sitemap
                        const sitemap = await parentUrlConverterInstance.discoverSitemap(content, options, browser);
                        
                        // Process each page
                        const maxPages = options.maxPages || Math.min(sitemap.pages.length, 10);
                        const pagesToProcess = sitemap.pages.slice(0, maxPages);
                        const processedPages = [];
                        
                        for (const page of pagesToProcess) {
                            // Process page
                            const pageContent = await parentUrlConverterInstance.processPage(
                                page.url, 
                                options, 
                                browser, 
                                tempDir
                            );
                            
                            // Add to processed pages
                            processedPages.push({
                                url: page.url,
                                title: page.title,
                                content: pageContent
                            });
                        }
                        
                        // Generate combined markdown
                        const markdown = parentUrlConverterInstance.generateCombinedMarkdown(
                            sitemap, 
                            processedPages, 
                            options
                        );
                        
                        // Close browser
                        await browser.close();
                        
                        // Clean up temporary directory
                        await fs.remove(tempDir);
                        
                        return {
                            success: true,
                            content: markdown,
                            name: name,
                            type: 'parenturl'
                        };
                    } catch (error) {
                        // Close browser on error
                        await browser.close();
                        
                        // Clean up temporary directory
                        await fs.remove(tempDir);
                        
                        // Re-throw error
                        throw error;
                    }
                } catch (error) {
                    console.error(`[ParentUrlAdapter] Error converting site: ${error.message}`);
                    throw new Error(`Site conversion failed: ${error.message}`);
                }
            },
            validate: (content) => typeof content === 'string' && content.length > 0,
            config: {
                name: 'Website Converter',
                extensions: ['.url', '.html', '.htm'],
                mimeTypes: ['text/html', 'application/x-url'],
                maxSize: 10 * 1024 * 1024 // 10MB
            }
        });
        
        const registeredTypes = Object.keys(this.converters);
        console.log(`✅ Converters registered successfully: ${registeredTypes.length} types`);
        console.log(`📋 Registered types: ${registeredTypes.join(', ')}`);
    } catch (error) {
        console.error('❌ Error setting up converters:', error);
        // Add detailed error logging
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        // Throw the error to be handled by the caller
        throw new Error(`Failed to set up converters: ${error.message}`);
    }
};

// Create and export singleton instance
var registry = new ConverterRegistry();
module.exports = registry;
