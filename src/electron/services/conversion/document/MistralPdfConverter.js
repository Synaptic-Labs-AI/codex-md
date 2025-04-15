/**
 * MistralPdfConverter.js
 * Handles conversion of PDF files to markdown using Mistral OCR.
 * 
 * This converter:
 * - Uses Mistral AI for OCR processing of PDF documents
 * - Handles scanned documents and images within PDFs
 * - Extracts text that standard PDF parsers might miss
 * - Creates structured markdown with high-quality text extraction
 * 
 * Related Files:
 * - BasePdfConverter.js: Parent class with common PDF functionality
 * - StandardPdfConverter.js: Alternative text-based converter
 * - FileStorageService.js: For temporary file management
 * - PdfConverterFactory.js: Factory for selecting appropriate converter
 */

const path = require('path');
const fs = require('fs-extra');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const BasePdfConverter = require('./BasePdfConverter');

// Initialize fetch with dynamic import
let fetchModule = null;

// Initialize fetch immediately
const initializeFetch = async () => {
  try {
    fetchModule = await import('node-fetch');
    console.log('[MistralPdfConverter] node-fetch loaded successfully');
  } catch (error) {
    console.error('[MistralPdfConverter] Failed to load node-fetch:', error);
    throw error;
  }
};

// Start loading immediately
const fetchPromise = initializeFetch();

// Create a wrapper function to ensure fetch is available
const fetchWithRetry = async (url, options) => {
  // Wait for fetch to be loaded if it's not ready yet
  if (!fetchModule) {
    await fetchPromise;
  }
  
  // Use the default export from the module
  return fetchModule.default(url, options);
};

class MistralPdfConverter extends BasePdfConverter {
    constructor(fileProcessor, fileStorage, openAIProxy, skipHandlerSetup = false) {
        super(fileProcessor, fileStorage);
        this.openAIProxy = openAIProxy;
        this.name = 'Mistral PDF Converter';
        this.description = 'Converts PDF files to markdown using Mistral OCR';
        this.apiEndpoint = process.env.MISTRAL_API_ENDPOINT || 'https://api.mistral.ai/v1/ocr';
        this.apiKey = process.env.MISTRAL_API_KEY;
        this.skipHandlerSetup = skipHandlerSetup;
        
        // Log whether handlers will be set up
        if (skipHandlerSetup) {
            console.log('[MistralPdfConverter] Skipping handler setup (skipHandlerSetup=true)');
        } else {
            this.setupIpcHandlers();
        }
    }

    /**
     * Set up IPC handlers for PDF conversion
     */
    setupIpcHandlers() {
        console.log('[MistralPdfConverter] Setting up IPC handlers');
        this.registerHandler('convert:pdf:ocr', this.handleConvert.bind(this));
        this.registerHandler('convert:pdf:ocr:metadata', this.handleGetMetadata.bind(this));
        this.registerHandler('convert:pdf:ocr:check', this.handleCheckApiKey.bind(this));
        console.log('[MistralPdfConverter] IPC handlers registered');
    }

    /**
     * Handle PDF conversion request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Conversion request details
     */
    async handleConvert(event, { filePath, options = {} }) {
        try {
            console.log('[MistralPdfConverter] handleConvert called with options:', {
                hasApiKey: !!this.apiKey,
                hasOptionsApiKey: !!options.mistralApiKey,
                fileName: options.name || path.basename(filePath)
            });
            
            // Use API key from options if available, otherwise use the one from the instance
            if (options.mistralApiKey) {
                console.log('[MistralPdfConverter] Using API key from options');
                this.apiKey = options.mistralApiKey;
            }
            
            // Check if API key is available
            if (!this.apiKey) {
                throw new Error('Mistral API key not configured');
            }
            
            const conversionId = this.generateConversionId();
            const window = event.sender.getOwnerBrowserWindow();
            
            // Create temp directory for this conversion
            const tempDir = await this.fileStorage.createTempDir('pdf_ocr_conversion');
            
            this.activeConversions.set(conversionId, {
                id: conversionId,
                status: 'starting',
                progress: 0,
                filePath,
                tempDir,
                window
            });

            // Notify client that conversion has started
            window.webContents.send('pdf:conversion-started', { conversionId });

            // Start conversion process
            this.processConversion(conversionId, filePath, options).catch(error => {
                console.error(`[MistralPdfConverter] Conversion failed for ${conversionId}:`, error);
                this.updateConversionStatus(conversionId, 'failed', { error: error.message });
                
                // Clean up temp directory
                fs.remove(tempDir).catch(err => {
                    console.error(`[MistralPdfConverter] Failed to clean up temp directory: ${tempDir}`, err);
                });
            });

            return { conversionId };
        } catch (error) {
            console.error('[MistralPdfConverter] Failed to start conversion:', error);
            throw error;
        }
    }

    /**
     * Handle PDF metadata request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     * @param {Object} request - Metadata request details
     */
    async handleGetMetadata(event, { filePath }) {
        try {
            // For metadata, we can use the standard PDF parser
            const standardConverter = new (require('./StandardPdfConverter'))(
                this.fileProcessor,
                this.fileStorage
            );
            
            const metadata = await standardConverter.extractMetadata(filePath);
            return metadata;
        } catch (error) {
            console.error('[MistralPdfConverter] Failed to get metadata:', error);
            throw error;
        }
    }

    /**
     * Handle API key check request
     * @param {Electron.IpcMainInvokeEvent} event - IPC event
     */
    async handleCheckApiKey(event) {
        try {
            if (!this.apiKey) {
                return { valid: false, error: 'API key not configured' };
            }
            
            // Make a simple request to check if the API key is valid
            const response = await fetchWithRetry(`${this.apiEndpoint}/models`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                return { valid: true };
            } else {
                const error = await response.json();
                return { valid: false, error: error.error?.message || 'Invalid API key' };
            }
        } catch (error) {
            console.error('[MistralPdfConverter] API key check failed:', error);
            return { valid: false, error: error.message };
        }
    }

    /**
     * Process PDF conversion
     * @param {string} conversionId - Conversion identifier
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     */
    async processConversion(conversionId, filePath, options) {
        try {
            const conversion = this.activeConversions.get(conversionId);
            if (!conversion) {
                throw new Error('Conversion not found');
            }
            
            const tempDir = conversion.tempDir;
            
            // Extract metadata
            this.updateConversionStatus(conversionId, 'extracting_metadata', { progress: 5 });
            const standardConverter = new (require('./StandardPdfConverter'))(
                this.fileProcessor,
                this.fileStorage
            );
            const metadata = await standardConverter.extractMetadata(filePath);
            
            // Process with OCR
            this.updateConversionStatus(conversionId, 'processing_ocr', { progress: 10 });
            const ocrResult = await this.processWithOcr(filePath, options);
            
            // Generate markdown
            this.updateConversionStatus(conversionId, 'generating_markdown', { progress: 90 });
            const markdown = this.generateMarkdown(metadata, ocrResult, options);
            
            // Clean up temp directory
            await fs.remove(tempDir);
            
            this.updateConversionStatus(conversionId, 'completed', { 
                progress: 100,
                result: markdown
            });
            
            return markdown;
        } catch (error) {
            console.error('[MistralPdfConverter] Conversion processing failed:', error);
            throw error;
        }
    }

    /**
     * Process PDF with Mistral OCR
     * @param {string} filePath - Path to PDF file
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} OCR result
     */
    async processWithOcr(filePath, options) {
        try {
            const form = new FormData();
            
            // Add file
            form.append('file', fs.createReadStream(filePath));
            
            // Add options
            form.append('model', options.model || 'mistral-large-ocr');
            
            if (options.language) {
                form.append('language', options.language);
            }
            
            // Make API request
            const response = await fetchWithRetry(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...form.getHeaders()
                },
                body: form
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error?.message || `OCR request failed with status ${response.status}`);
            }
            
            const result = await response.json();
            return this.processOcrResult(result);
        } catch (error) {
            console.error('[MistralPdfConverter] OCR processing failed:', error);
            throw error;
        }
    }

    /**
     * Process OCR result
     * @param {Object} result - OCR API result
     * @returns {Object} Processed result
     */
    /**
     * Process OCR result from Mistral API
     * @param {Object} result - OCR API result
     * @returns {Object} Processed result with structured content
     */
    processOcrResult(result) {
        console.log('[MistralPdfConverter] Processing OCR result');
        
        try {
            if (!result) {
                throw new Error('Empty OCR result received');
            }
            
            // Log the structure of the result for debugging
            console.log('[MistralPdfConverter] OCR result structure:',
                Object.keys(result).join(', '));
            
            // Extract document-level information
            const documentInfo = {
                model: result.model || 'unknown',
                language: result.language || 'unknown',
                processingTime: result.processing_time || 0,
                overallConfidence: result.confidence || 0,
                usage: result.usage || null
            };
            
            // Process pages based on Mistral OCR API response format
            let pages = [];
            
            // Handle different response formats
            if (result.pages && Array.isArray(result.pages)) {
                // Standard format with pages array
                pages = result.pages;
            } else if (result.data && Array.isArray(result.data)) {
                // Alternative format with data array
                pages = result.data;
            } else if (result.content && typeof result.content === 'string') {
                // Simple format with just content string
                pages = [{
                    page_number: 1,
                    text: result.content,
                    confidence: result.confidence || 0
                }];
            } else if (result.text && typeof result.text === 'string') {
                // Another simple format with just text
                pages = [{
                    page_number: 1,
                    text: result.text,
                    confidence: result.confidence || 0
                }];
            }
            
            console.log(`[MistralPdfConverter] Processing ${pages.length} pages from OCR result`);
            
            const processedPages = pages.map((page, index) => {
                // Basic page information with fallbacks
                const pageNumber = page.page_number || page.pageNumber || index + 1;
                const processedPage = {
                    pageNumber,
                    confidence: page.confidence || 0,
                    width: page.width || page.dimensions?.width || 0,
                    height: page.height || page.dimensions?.height || 0,
                    text: ''
                };
                
                // Process structured content if available
                if (page.blocks && Array.isArray(page.blocks)) {
                    // Process blocks (paragraphs, headings, lists, tables, etc.)
                    const textBlocks = this.processContentBlocks(page.blocks);
                    processedPage.text = textBlocks.join('\n\n');
                } else if (page.elements && Array.isArray(page.elements)) {
                    // Alternative structure with elements instead of blocks
                    const elements = page.elements.map(element => {
                        if (element.type === 'text' && element.text) {
                            return element.text;
                        } else if (element.content) {
                            return element.content;
                        }
                        return '';
                    }).filter(text => text.trim().length > 0);
                    
                    processedPage.text = elements.join('\n\n');
                } else if (page.content && typeof page.content === 'string') {
                    // Simple content field
                    processedPage.text = page.content;
                } else if (page.text) {
                    // Fallback to raw text if structured content is not available
                    processedPage.text = page.text;
                }
                
                return processedPage;
            });
            
            console.log(`[MistralPdfConverter] OCR result processing complete for ${processedPages.length} pages`);
            
            return {
                documentInfo,
                pages: processedPages
            };
        } catch (error) {
            console.error('[MistralPdfConverter] Error processing OCR result:', error);
            
            // Provide detailed error information
            console.error('[MistralPdfConverter] OCR result that caused error:',
                result ? JSON.stringify(result, null, 2).substring(0, 500) + '...' : 'undefined');
            
            // Fallback to basic processing if an error occurs
            let pages = [];
            
            try {
                // Attempt to extract any usable information
                if (result && result.pages && Array.isArray(result.pages)) {
                    pages = result.pages;
                } else if (result && result.data && Array.isArray(result.data)) {
                    pages = result.data;
                } else if (result && typeof result === 'string') {
                    // Handle case where result might be a string
                    pages = [{ text: result }];
                } else if (result && result.text && typeof result.text === 'string') {
                    pages = [{ text: result.text }];
                }
            } catch (fallbackError) {
                console.error('[MistralPdfConverter] Fallback processing also failed:', fallbackError);
                pages = [];
            }
            
            return {
                documentInfo: {
                    model: result?.model || 'unknown',
                    language: result?.language || 'unknown',
                    error: error.message
                },
                pages: pages.map((page, index) => ({
                    pageNumber: page.page_number || page.pageNumber || index + 1,
                    text: page.text || page.content || '',
                    confidence: page.confidence || 0
                }))
            };
        }
    }
    
    /**
     * Process content blocks from OCR result
     * @param {Array} blocks - Content blocks from OCR
     * @returns {Array} Processed text blocks
     */
    processContentBlocks(blocks) {
        if (!Array.isArray(blocks) || blocks.length === 0) {
            return [];
        }
        
        return blocks.map(block => {
            try {
                // Handle case where block might be a string
                if (typeof block === 'string') {
                    return block;
                }
                
                // Handle case where block might have direct text content
                if (!block.type && block.text) {
                    return block.text;
                }
                
                // Process different types of blocks
                switch (block.type?.toLowerCase()) {
                    case 'heading':
                        return this.processHeading(block);
                    case 'paragraph':
                    case 'text':
                        return this.processParagraph(block);
                    case 'list':
                    case 'bullet_list':
                    case 'numbered_list':
                        return this.processList(block);
                    case 'table':
                        return this.processTable(block);
                    case 'image':
                    case 'figure':
                        return this.processImage(block);
                    case 'code':
                    case 'code_block':
                        return this.processCodeBlock(block);
                    case 'quote':
                    case 'blockquote':
                        return this.processQuote(block);
                    default:
                        // For unknown block types, just return the text if available
                        return block.text || block.content || '';
                }
            } catch (error) {
                console.error('[MistralPdfConverter] Error processing content block:', error);
                // Return empty string if processing fails
                return '';
            }
        }).filter(text => text.trim().length > 0); // Filter out empty blocks
    }
    
    /**
     * Process heading block
     * @param {Object} block - Heading block
     * @returns {string} Markdown heading
     */
    processHeading(block) {
        const level = block.level || 1;
        const headingMarkers = '#'.repeat(Math.min(level, 6));
        return `${headingMarkers} ${block.text || ''}`;
    }
    
    /**
     * Process paragraph block
     * @param {Object} block - Paragraph block
     * @returns {string} Paragraph text
     */
    processParagraph(block) {
        return block.text || '';
    }
    
    /**
     * Process list block
     * @param {Object} block - List block
     * @returns {string} Markdown list
     */
    processList(block) {
        if (!block.items || !Array.isArray(block.items) || block.items.length === 0) {
            return '';
        }
        
        const listType = block.ordered ? 'ordered' : 'unordered';
        
        return block.items.map((item, index) => {
            if (listType === 'ordered') {
                return `${index + 1}. ${item.text || ''}`;
            } else {
                return `- ${item.text || ''}`;
            }
        }).join('\n');
    }
    
    /**
     * Process table block
     * @param {Object} block - Table block
     * @returns {string} Markdown table
     */
    processTable(block) {
        if (!block.rows || !Array.isArray(block.rows) || block.rows.length === 0) {
            return '';
        }
        
        const tableRows = block.rows.map(row => {
            if (!row.cells || !Array.isArray(row.cells)) {
                return '| |';
            }
            
            const cells = row.cells.map(cell => cell.text || '').join(' | ');
            return `| ${cells} |`;
        });
        
        // Insert header separator after the first row
        if (tableRows.length > 1) {
            const headerRow = tableRows[0];
            const separatorCount = (headerRow.match(/\|/g) || []).length - 1;
            const separator = `|${' --- |'.repeat(separatorCount)}`;
            tableRows.splice(1, 0, separator);
        }
        
        return tableRows.join('\n');
    }
    
    /**
     * Process image block
     * @param {Object} block - Image block
     * @returns {string} Markdown image reference
     */
    processImage(block) {
        const caption = block.caption || block.alt || 'Image';
        const source = block.src || block.source || block.url || 'image-reference';
        return `![${caption}](${source})`;
    }
    
    /**
     * Process code block
     * @param {Object} block - Code block
     * @returns {string} Markdown code block
     */
    processCodeBlock(block) {
        const language = block.language || '';
        const code = block.text || block.content || block.code || '';
        return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    
    /**
     * Process quote block
     * @param {Object} block - Quote block
     * @returns {string} Markdown quote
     */
    processQuote(block) {
        const text = block.text || block.content || '';
        // Split by newlines and add > to each line
        return text.split('\n').map(line => `> ${line}`).join('\n');
    }

    /**
     * Generate markdown from PDF metadata and OCR result
     * @param {Object} metadata - PDF metadata
     * @param {Object} ocrResult - OCR result
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    /**
     * Generate markdown from PDF metadata and OCR result
     * @param {Object} metadata - PDF metadata
     * @param {Object} ocrResult - OCR result
     * @param {Object} options - Conversion options
     * @returns {string} Markdown content
     */
    generateMarkdown(metadata, ocrResult, options) {
        console.log('[MistralPdfConverter] Generating markdown from OCR result');
        
        try {
            // Start with header
            const markdown = this.generateMarkdownHeader(metadata, options);
            
            // Add OCR information
            markdown.push('## OCR Information');
            markdown.push('');
            markdown.push('This document was processed using Mistral OCR technology.');
            
            // Add OCR model and language information if available
            if (ocrResult && ocrResult.documentInfo) {
                const docInfo = ocrResult.documentInfo;
                markdown.push('');
                markdown.push('| Property | Value |');
                markdown.push('| --- | --- |');
                
                if (docInfo.model && docInfo.model !== 'unknown') {
                    markdown.push(`| Model | ${docInfo.model} |`);
                }
                
                if (docInfo.language && docInfo.language !== 'unknown') {
                    markdown.push(`| Language | ${docInfo.language} |`);
                }
                
                if (docInfo.processingTime) {
                    markdown.push(`| Processing Time | ${docInfo.processingTime}s |`);
                }
                
                if (docInfo.overallConfidence) {
                    const confidencePercent = Math.round(docInfo.overallConfidence * 100);
                    markdown.push(`| Overall Confidence | ${confidencePercent}% |`);
                }
                
                // Add usage information if available
                if (docInfo.usage) {
                    if (docInfo.usage.total_tokens) {
                        markdown.push(`| Total Tokens | ${docInfo.usage.total_tokens} |`);
                    }
                    if (docInfo.usage.prompt_tokens) {
                        markdown.push(`| Prompt Tokens | ${docInfo.usage.prompt_tokens} |`);
                    }
                    if (docInfo.usage.completion_tokens) {
                        markdown.push(`| Completion Tokens | ${docInfo.usage.completion_tokens} |`);
                    }
                }
                
                // Add error information if present
                if (docInfo.error) {
                    markdown.push(`| Error | ${docInfo.error} |`);
                }
            }
            
            markdown.push('');
            
            // Add content for each page
            if (ocrResult && ocrResult.pages && ocrResult.pages.length > 0) {
                ocrResult.pages.forEach((page, index) => {
                    // Use page number if available, otherwise use index + 1
                    const pageNumber = page.pageNumber || index + 1;
                    markdown.push(`## Page ${pageNumber}`);
                    markdown.push('');
                    
                    // Add page confidence if available
                    if (page.confidence) {
                        const confidencePercent = Math.round(page.confidence * 100);
                        markdown.push(`> OCR Confidence: ${confidencePercent}%`);
                        markdown.push('');
                    }
                    
                    // Add page dimensions if available
                    if (page.width && page.height) {
                        markdown.push(`> Dimensions: ${page.width} × ${page.height}`);
                        markdown.push('');
                    }
                    
                    // Add page text with better handling of different content formats
                    let pageContent = '';
                    
                    if (page.text && page.text.trim()) {
                        pageContent = page.text;
                    } else if (page.content && typeof page.content === 'string' && page.content.trim()) {
                        pageContent = page.content;
                    } else if (page.blocks && Array.isArray(page.blocks) && page.blocks.length > 0) {
                        // If we have blocks but text wasn't processed earlier, process them now
                        const textBlocks = this.processContentBlocks(page.blocks);
                        pageContent = textBlocks.join('\n\n');
                    } else if (page.elements && Array.isArray(page.elements) && page.elements.length > 0) {
                        // If we have elements but text wasn't processed earlier, process them now
                        const elements = page.elements.map(element => {
                            if (element.type === 'text' && element.text) {
                                return element.text;
                            } else if (element.content) {
                                return element.content;
                            }
                            return '';
                        }).filter(text => text.trim().length > 0);
                        
                        pageContent = elements.join('\n\n');
                    }
                    
                    if (pageContent && pageContent.trim()) {
                        markdown.push(pageContent);
                    } else {
                        markdown.push('*No text content was extracted from this page.*');
                    }
                    
                    markdown.push('');
                });
            } else {
                markdown.push('No text content was extracted from this document.');
                
                // If we have a raw text field at the document level, use that
                if (ocrResult && ocrResult.text && typeof ocrResult.text === 'string' && ocrResult.text.trim()) {
                    markdown.push('');
                    markdown.push('## Document Content');
                    markdown.push('');
                    markdown.push(ocrResult.text);
                } else if (ocrResult && ocrResult.content && typeof ocrResult.content === 'string' && ocrResult.content.trim()) {
                    markdown.push('');
                    markdown.push('## Document Content');
                    markdown.push('');
                    markdown.push(ocrResult.content);
                }
            }
            
            console.log('[MistralPdfConverter] Markdown generation complete');
            return markdown.join('\n');
        } catch (error) {
            console.error('[MistralPdfConverter] Error generating markdown:', error);
            
            // Create a fallback markdown with error information
            const fallbackMarkdown = [
                '# OCR Conversion Result',
                '',
                '## Error Information',
                '',
                `An error occurred during markdown generation: ${error.message}`,
                '',
                '## Document Information',
                ''
            ];
            
            // Add any metadata we have
            if (metadata) {
                fallbackMarkdown.push('### Metadata');
                fallbackMarkdown.push('');
                
                if (metadata.title) {
                    fallbackMarkdown.push(`**Title:** ${metadata.title}`);
                }
                if (metadata.author) {
                    fallbackMarkdown.push(`**Author:** ${metadata.author}`);
                }
                if (metadata.subject) {
                    fallbackMarkdown.push(`**Subject:** ${metadata.subject}`);
                }
                if (metadata.keywords) {
                    fallbackMarkdown.push(`**Keywords:** ${metadata.keywords}`);
                }
                if (metadata.creator) {
                    fallbackMarkdown.push(`**Creator:** ${metadata.creator}`);
                }
                if (metadata.producer) {
                    fallbackMarkdown.push(`**Producer:** ${metadata.producer}`);
                }
                if (metadata.creationDate) {
                    fallbackMarkdown.push(`**Creation Date:** ${metadata.creationDate}`);
                }
                if (metadata.modificationDate) {
                    fallbackMarkdown.push(`**Modification Date:** ${metadata.modificationDate}`);
                }
                
                fallbackMarkdown.push('');
            }
            
            // Add any raw OCR result text if available
            if (ocrResult) {
                fallbackMarkdown.push('### OCR Result');
                fallbackMarkdown.push('');
                
                if (ocrResult.text) {
                    fallbackMarkdown.push(ocrResult.text);
                } else if (ocrResult.content) {
                    fallbackMarkdown.push(ocrResult.content);
                } else if (ocrResult.pages && ocrResult.pages.length > 0) {
                    ocrResult.pages.forEach((page, index) => {
                        fallbackMarkdown.push(`#### Page ${index + 1}`);
                        fallbackMarkdown.push('');
                        fallbackMarkdown.push(page.text || page.content || '*No content available*');
                        fallbackMarkdown.push('');
                    });
                } else {
                    fallbackMarkdown.push('*No OCR content available*');
                }
            }
            
            return fallbackMarkdown.join('\n');
        }
    }

    /**
     * Convert PDF content to markdown - direct method for ConverterRegistry
     * @param {Buffer} content - PDF content as buffer
     * @param {string} name - File name
     * @param {string} apiKey - API key for Mistral
     * @param {Object} options - Conversion options
     * @returns {Promise<Object>} Conversion result
     */
    async convertToMarkdown(content, options = {}) {
        let tempDir = null;
        
        try {
            console.log(`[MistralPdfConverter] Converting PDF with OCR: ${options.name || 'unnamed'}`);
            
            // Check if API key is available from multiple sources
            if (!this.apiKey && !options.apiKey && !process.env.MISTRAL_API_KEY) {
                throw new Error('Mistral API key not configured');
            }
            
            // Use the API key from options if provided, then from instance, then from env
            const apiKey = options.apiKey || this.apiKey || process.env.MISTRAL_API_KEY;
            
            // Temporarily set the API key for this operation
            const originalApiKey = this.apiKey;
            this.apiKey = apiKey;
            
            console.log('[MistralPdfConverter] Using API key for OCR conversion');
            
            // Create a temporary file to process
            tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'pdf-ocr-conversion-'));
            const tempFile = path.join(tempDir, `${options.name || 'document'}.pdf`);
            
            // Write buffer to temp file
            await fs.writeFile(tempFile, content);
            
            // Extract metadata using standard methods
            const StandardPdfConverter = require('./StandardPdfConverter');
            const standardConverter = new StandardPdfConverter();
            const metadata = await standardConverter.extractMetadata(tempFile);
            
            // Log metadata for debugging
            console.log('[MistralPdfConverter] Extracted metadata:', {
                title: metadata.title,
                author: metadata.author,
                pageCount: metadata.pageCount
            });
            
            // Actually process with OCR using the existing method
            console.log('[MistralPdfConverter] Processing PDF with OCR');
            const ocrResult = await this.processWithOcr(tempFile, {
                ...options,
                model: options.model || 'mistral-large-ocr',
                language: options.language
            });
            
            // Log OCR result structure for debugging
            console.log('[MistralPdfConverter] OCR result structure:',
                ocrResult ? Object.keys(ocrResult).join(', ') : 'null');
            console.log('[MistralPdfConverter] OCR pages count:',
                ocrResult && ocrResult.pages ? ocrResult.pages.length : 0);
            
            // Get current datetime
            const now = new Date();
            const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');
            
            // Get the title from metadata or filename
            const fileTitle = metadata.title || options.name || 'PDF Document';
            
            // Create standardized frontmatter
            const frontmatter = [
                '---',
                `title: ${fileTitle}`,
                `converted: ${convertedDate}`,
                'type: pdf-ocr',
                '---',
                ''
            ].join('\n');
            
            // Generate markdown from OCR results
            const markdownContent = this.generateMarkdown(metadata, ocrResult, options);
            
            // Combine frontmatter and content
            const finalMarkdown = frontmatter + markdownContent;
            
            // Create result object with enhanced information
            const result = {
                success: true,
                content: finalMarkdown,
                type: 'pdf',
                name: options.name || 'document.pdf',
                metadata: metadata,
                ocrInfo: {
                    model: ocrResult?.documentInfo?.model || 'unknown',
                    language: ocrResult?.documentInfo?.language || 'unknown',
                    pageCount: ocrResult?.pages?.length || 0,
                    confidence: ocrResult?.documentInfo?.overallConfidence || 0
                }
            };
            
            // Restore original API key
            this.apiKey = originalApiKey;
            
            // Clean up temp directory
            if (tempDir) {
                await fs.remove(tempDir)
                    .catch(err => console.error('[MistralPdfConverter] Error cleaning up temp directory:', err));
                tempDir = null;
            }
            
            return result;
        } catch (error) {
            console.error('[MistralPdfConverter] Direct conversion failed:', error);
            
            // Clean up temp directory if it exists
            if (tempDir) {
                try {
                    await fs.remove(tempDir);
                } catch (cleanupError) {
                    console.error('[MistralPdfConverter] Error cleaning up temp directory:', cleanupError);
                }
            }
            
            // Create a more detailed error message
            const errorDetails = error.response ?
                `API response: ${JSON.stringify(error.response.data || {})}` :
                error.message;
            
            return {
                success: false,
                error: `PDF OCR conversion failed: ${error.message}`,
                errorDetails: errorDetails,
                content: `# Conversion Error\n\nFailed to convert PDF with OCR: ${error.message}\n\n## Error Details\n\n${errorDetails}`
            };
        }
    }

    /**
     * Get converter information
     * @returns {Object} Converter details
     */
    getInfo() {
        return {
            name: this.name,
            extensions: this.supportedExtensions,
            description: this.description,
            options: {
                title: 'Optional document title',
                model: 'OCR model to use (default: mistral-large-ocr)',
                language: 'Language hint for OCR (optional)',
                maxPages: 'Maximum pages to convert (default: all)'
            }
        };
    }
}

module.exports = MistralPdfConverter;
