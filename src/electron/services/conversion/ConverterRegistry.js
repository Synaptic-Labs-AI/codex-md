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
    this.activeConversions = new Map(); // Global map to track all active conversions
    this.setupConverters();
    this.setupConversionValidation();
    
    // Clean up resources when the process exits
    process.on('exit', () => this.cleanup());
    process.on('SIGINT', () => {
        this.cleanup();
        process.exit(0);
    });
}

/**
 * Sets up periodic validation of active conversions to clean up stale ones.
 * This helps prevent memory leaks and resource issues by removing conversions
 * that haven't been updated recently.
 */
ConverterRegistry.prototype.setupConversionValidation = function() {
    // Set up interval to check for stale conversions every minute
    this.validationInterval = setInterval(() => {
        try {
            const now = Date.now();
            let staleCount = 0;
            
            // Check all active conversions
            Array.from(this.activeConversions.entries()).forEach(([id, conv]) => {
                // Consider a conversion stale if it hasn't pinged in the last 30 seconds
                if (now - conv.lastPing > 30000) {
                    // Remove the stale conversion
                    this.activeConversions.delete(id);
                    staleCount++;
                    
                    // Log the removal
                    console.warn(`[ConverterRegistry] Stale conversion ${id} removed (inactive for ${Math.round((now - conv.lastPing) / 1000)}s)`);
                    
                    // If the conversion has a cleanup function, call it
                    if (typeof conv.cleanup === 'function') {
                        try {
                            conv.cleanup();
                        } catch (cleanupError) {
                            console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
                        }
                    }
                }
            });
            
            // Log summary if any stale conversions were removed
            if (staleCount > 0) {
                console.log(`[ConverterRegistry] Removed ${staleCount} stale conversions. Active conversions remaining: ${this.activeConversions.size}`);
            }
        } catch (error) {
            console.error('[ConverterRegistry] Error during conversion validation:', error);
        }
    }, 60000); // Run every 60 seconds
};

/**
 * Registers an active conversion with the registry.
 * @param {string} id - Unique identifier for the conversion
 * @param {Object} conversionData - Data about the conversion
 * @param {Function} [cleanup] - Optional cleanup function to call when the conversion is removed
 */
ConverterRegistry.prototype.registerConversion = function(id, conversionData, cleanup) {
    if (!id) {
        console.error('[ConverterRegistry] Cannot register conversion without ID');
        return;
    }
    
    this.activeConversions.set(id, {
        ...conversionData,
        lastPing: Date.now(),
        cleanup: cleanup
    });
    
    console.log(`[ConverterRegistry] Registered conversion ${id}. Total active: ${this.activeConversions.size}`);
};

/**
 * Updates the last ping time for an active conversion to keep it alive.
 * @param {string} id - Unique identifier for the conversion
 * @param {Object} [updates] - Optional updates to the conversion data
 * @returns {boolean} - Whether the conversion was found and updated
 */
ConverterRegistry.prototype.pingConversion = function(id, updates = {}) {
    const conversion = this.activeConversions.get(id);
    if (!conversion) {
        return false;
    }
    
    // Update the last ping time and any other provided updates
    this.activeConversions.set(id, {
        ...conversion,
        ...updates,
        lastPing: Date.now()
    });
    
    return true;
};

/**
 * Removes an active conversion from the registry.
 * @param {string} id - Unique identifier for the conversion
 * @returns {boolean} - Whether the conversion was found and removed
 */
ConverterRegistry.prototype.removeConversion = function(id) {
    const conversion = this.activeConversions.get(id);
    if (!conversion) {
        return false;
    }
    
    // If the conversion has a cleanup function, call it
    if (typeof conversion.cleanup === 'function') {
        try {
            conversion.cleanup();
        } catch (cleanupError) {
            console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
        }
    }
    
    // Remove the conversion
    this.activeConversions.delete(id);
    console.log(`[ConverterRegistry] Removed conversion ${id}. Total active: ${this.activeConversions.size}`);
    
    return true;
};

/**
 * Gets an active conversion from the registry.
 * @param {string} id - Unique identifier for the conversion
 * @returns {Object|null} - The conversion data or null if not found
 */
ConverterRegistry.prototype.getConversion = function(id) {
    return this.activeConversions.get(id) || null;
};

/**
 * Cleans up resources used by the registry.
 * This should be called when the application is shutting down.
 */
ConverterRegistry.prototype.cleanup = function() {
    // Clear the validation interval
    if (this.validationInterval) {
        clearInterval(this.validationInterval);
        this.validationInterval = null;
    }
    
    // Clean up all active conversions
    const conversionCount = this.activeConversions.size;
    if (conversionCount > 0) {
        console.log(`[ConverterRegistry] Cleaning up ${conversionCount} active conversions`);
        
        Array.from(this.activeConversions.entries()).forEach(([id, conv]) => {
            // If the conversion has a cleanup function, call it
            if (typeof conv.cleanup === 'function') {
                try {
                    conv.cleanup();
                } catch (cleanupError) {
                    console.error(`[ConverterRegistry] Error cleaning up conversion ${id}:`, cleanupError);
                }
            }
        });
        
        // Clear the map
        this.activeConversions.clear();
    }
    
    console.log('[ConverterRegistry] Cleanup complete');
};

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
        const MediaConverter = require('./multimedia/MediaConverter');
        const PdfFactory = require('./document/PdfConverterFactory');
        const DocxConverter = require('./document/DocxConverter');
        const PptxConverter = require('./document/PptxConverter');
        const UrlConverter = require('./web/UrlConverter');
        const ParentUrlConverter = require('./web/ParentUrlConverter');

        // Import singleton service instances
        const fileProcessorServiceInstance = require('../storage/FileProcessorService');
        const fileStorageServiceInstance = require('../storage/FileStorageService');
        const deepgramServiceInstance = require('../ai/DeepgramService');

        // Create instances of converter classes, passing singleton dependencies
        const csvConverterInstance = new CsvConverter();
        const xlsxConverterInstance = new XlsxConverter();
        // Pass the singleton instances to the constructors
        const mediaConverterInstance = new MediaConverter(this, fileProcessorServiceInstance, fileStorageServiceInstance);
        const pdfConverterFactory = new PdfFactory();
        const docxConverterInstance = new DocxConverter();
        const pptxConverterInstance = new PptxConverter();
        
        // Instantiate URL converters with singleton dependencies (or mocks if appropriate)
        // Note: URL converters might not need the full file services, using mocks might still be okay here
        // Using singletons for consistency, but could revert to mocks if needed.
        const urlConverterInstance = new UrlConverter(fileProcessorServiceInstance, fileStorageServiceInstance);
        const parentUrlConverterInstance = new ParentUrlConverter(fileProcessorServiceInstance, fileStorageServiceInstance);

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
        
        // Create standardized adapter for PPTX converter using the actual implementation
        this.register('pptx', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[PptxAdapter] Converting PPTX file: ${name}`);
                    
                    // Ensure content is a Buffer
                    if (!Buffer.isBuffer(content)) {
                        throw new Error('PPTX content must be a Buffer');
                    }
                    
                    // Use the actual PptxConverter implementation
                    const result = await pptxConverterInstance.convertToMarkdown(content, {
                        ...options,
                        fileName: name,
                        apiKey
                    });
                    
                    // Ensure we have content
                    if (!result || typeof result !== 'string' || result.trim() === '') {
                        throw new Error('PPTX conversion produced empty content');
                    }
                    
                    return {
                        success: true,
                        content: result,
                        name: name,
                        type: 'pptx'
                    };
                } catch (error) {
                    console.error(`[PptxAdapter] Error converting PPTX: ${error.message}`);
                    throw new Error(`PPTX conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'PPTX Converter',
                extensions: ['.pptx', '.ppt'],
                mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });
        
        // Create standardized adapter for the CSV converter
        this.register('csv', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[CsvAdapter] Converting CSV file: ${name}`);
                    
                    // Convert the content to string
                    const contentStr = content.toString();
                    
                    // Use the actual CsvConverter implementation
                    const result = await csvConverterInstance.convertToMarkdown(contentStr, {
                        ...options,
                        name,
                        originalFileName: name // Pass the original filename
                    });
                    
                    // Ensure we have content
                    if (!result || typeof result !== 'string' || result.trim() === '') {
                        throw new Error('CSV conversion produced empty content');
                    }
                    
                    return {
                        success: true,
                        content: result,
                        name: name,
                        type: 'csv'
                    };
                } catch (error) {
                    console.error(`[CsvAdapter] Error converting CSV: ${error.message}`);
                    throw new Error(`CSV conversion failed: ${error.message}`);
                }
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
                try {
                    console.log(`[XlsxAdapter] Converting Excel file: ${name}`);
                    
                    // Ensure content is a Buffer
                    if (!Buffer.isBuffer(content)) {
                        throw new Error('Excel content must be a Buffer');
                    }
                    
                    // Read the Excel file using xlsx library
                    const xlsx = require('xlsx');
                    let workbook;
                    
                    try {
                        // Create a temporary file to read the Excel content
                        const fs = require('fs-extra');
                        const os = require('os');
                        const path = require('path');
                        const tempDir = path.join(os.tmpdir(), `xlsx_conversion_${Date.now()}`);
                        await fs.ensureDir(tempDir);
                        
                        // Store original name for later use
                        const originalFileName = name;

                        // Create a temp file with a generic name
                        const tempFile = path.join(tempDir, `excel_conversion_${Date.now()}.xlsx`);
                        await fs.writeFile(tempFile, content);

                        // Read the Excel file
                        workbook = xlsx.readFile(tempFile, {
                            cellDates: true,
                            ...(options.xlsxOptions || {})
                        });
                        
                        // Clean up temp file
                        await fs.remove(tempDir);
                    } catch (readError) {
                        console.error(`[XlsxAdapter] Failed to read Excel file: ${name}`, readError);
                        throw new Error(`Failed to read Excel file: ${readError.message}`);
                    }
                    // Use the actual XlsxConverter implementation
                    const result = await xlsxConverterInstance.convertToMarkdown(workbook, {
                        ...options,
                        name: originalFileName || name,
                        originalFileName: originalFileName || name // Pass the original filename
                    });
                    
                    // Ensure we have content
                    if (!result || typeof result !== 'string' || result.trim() === '') {
                        throw new Error('Excel conversion produced empty content');
                    }
                    
                    // Make sure we're properly returning the original filename
                    return {
                        success: true,
                        content: result,
                        name: originalFileName || name,
                        type: 'xlsx',
                        originalFileName: originalFileName || name // Ensure the original filename is preserved
                    };
                } catch (error) {
                    console.error(`[XlsxAdapter] Error converting Excel: ${error.message}`);
                    throw new Error(`Excel conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'Excel Converter',
                extensions: ['.xlsx', '.xls'],
                mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
                maxSize: 100 * 1024 * 1024 // 100MB
            }
        });

        // Create standardized adapter for media converters (audio and video)
        const mediaAdapter = {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log(`[MediaAdapter] Converting media file: ${name}`);

                    // Ensure content is a Buffer
                    if (!Buffer.isBuffer(content)) {
                        throw new Error('Media content must be a Buffer');
                    }

                    // Create a temporary file to process the media
                    const tempDir = await fileStorageServiceInstance.createTempDir('media_conversion');
                    const tempFile = path.join(tempDir, `${name}_${Date.now()}${path.extname(name) || '.mp4'}`);
                    await fs.writeFile(tempFile, content);

                    // Get deepgram API key from options or settings
                    const deepgramApiKey = options.deepgramApiKey || '';

                    // Process the media file using MediaConverter
                    // Simulate an event object for the handler
                    const mockEvent = { sender: { getOwnerBrowserWindow: () => null } };

                    const result = await mediaConverterInstance.handleConvert(mockEvent, {
                        filePath: tempFile,
                        options: {
                            ...options,
                            transcribe: options.transcribe !== false,
                            deepgramApiKey: deepgramApiKey,
                            language: options.language || 'en',
                            title: options.title || name,
                            _tempDir: tempDir // Pass tempDir for cleanup
                        }
                    });

                    // Media conversion is handled asynchronously, so we return a placeholder
                    // The actual content will be available via the conversion progress events
                    return {
                        success: true,
                        conversionId: result.conversionId,
                        async: true,
                        name: name,
                        type: 'media'
                    };
                } catch (error) {
                    console.error(`[MediaAdapter] Error converting media: ${error.message}`);
                    throw new Error(`Media conversion failed: ${error.message}`);
                }
            },
            validate: (content) => Buffer.isBuffer(content) && content.length > 0,
            config: {
                name: 'Media Converter',
                extensions: ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.mp4', '.mov', '.avi', '.mkv', '.webm'],
                mimeTypes: [
                    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/flac',
                    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'
                ],
                maxSize: 500 * 1024 * 1024 // 500MB
            }
        };

        // Register all media formats to use the same converter
        this.register('mp3', mediaAdapter);
        this.register('wav', mediaAdapter);
        this.register('ogg', mediaAdapter);
        this.register('m4a', mediaAdapter);
        this.register('flac', mediaAdapter);
        this.register('mp4', mediaAdapter);
        this.register('mov', mediaAdapter);
        this.register('avi', mediaAdapter);
        this.register('mkv', mediaAdapter);
        this.register('webm', mediaAdapter);

        // Register ppt extension to use the same converter as pptx
        this.register('ppt', this.converters['pptx']);

        // Register the PDF factory adapter with proper implementation
        this.register('pdf', {
            convert: async (content, name, apiKey, options) => {
                try {
                    console.log("[PdfAdapter] Converting PDF document");
                    
                    
                    // Create temp directory for conversion using the singleton service
                    const tempDir = await fileStorageServiceInstance.createTempDir('pdf_conversion'); 
                    
                    // Ensure the directory exists
                    await fs.ensureDir(tempDir);
                    
                    const tempFile = path.join(tempDir, `document_${Date.now()}.pdf`);
                    
                    // Write buffer to temp file
                    await fs.writeFile(tempFile, content);
                    
                    // Verify the file was written successfully
                    if (!(await fs.pathExists(tempFile))) {
                        throw new Error(`Failed to write temporary PDF file: ${tempFile}`);
                    }
                    
                    try {
                        // Determine if OCR should be used
                        // Determine if OCR should be used
                        const useOcr = options.useOcr === true && options.mistralApiKey;
                        
                        // Create appropriate converter
                        let result;
                        if (useOcr) {
                            console.log('[ConverterRegistry] Using Mistral OCR converter for PDF conversion');
                            // Use Mistral OCR converter - require it directly to ensure it's in scope
                            // Pass true for skipHandlerSetup to avoid duplicate IPC handler registration
                            // Pass singleton services
                            const MistralPdfConverterClass = require('./document/MistralPdfConverter');
                            const mistralConverter = new MistralPdfConverterClass(fileProcessorServiceInstance, fileStorageServiceInstance, null, true); 
                            // Set the API key
                            mistralConverter.apiKey = options.mistralApiKey;
                            console.log('[ConverterRegistry] Mistral API key set for OCR conversion');
                            
                            result = await mistralConverter.convertToMarkdown(content, {
                                ...options,
                                fileName: name,
                                name: name,
                                apiKey: options.mistralApiKey
                            });
                        } else {
                            // Use standard converter - require it directly to ensure it's in scope
                            // Pass true for skipHandlerSetup to avoid duplicate IPC handler registration
                            // Pass singleton services
                            console.log('[ConverterRegistry] Using standard PDF converter');
                            const StandardPdfConverterClass = require('./document/StandardPdfConverter');
                            const standardConverter = new StandardPdfConverterClass(fileProcessorServiceInstance, fileStorageServiceInstance, true); 
                                
                            result = await standardConverter.convertToMarkdown(content, {
                                ...options,
                                fileName: name
                            });
                        }
                        
                        // Clean up temp directory
                        await fs.remove(tempDir);
                        
                        // Ensure result has success flag and content
                        if (!result.success) {
                            throw new Error(result.error || 'PDF conversion failed with no specific error');
                        }
                        
                        if (!result.content || typeof result.content !== 'string' || result.content.trim() === '') {
                            throw new Error('PDF conversion produced empty content');
                        }
                        
                        return result;
                    } catch (error) {
                        // Clean up temp directory
                        await fs.remove(tempDir);
                        
                        // Re-throw error
                        throw error;
                    }
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
                    
                    // Create temporary directory for the conversion using the singleton service
                    const tempDir = await fileStorageServiceInstance.createTempDir('url_conversion'); 
                    
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
                    
                    // Create temporary directory for the conversion using the singleton service
                    const tempDir = await fileStorageServiceInstance.createTempDir('parent_url_conversion'); 
                    
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
