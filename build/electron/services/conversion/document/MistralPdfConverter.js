"use strict";

function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
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
const {
  v4: uuidv4
} = require('uuid');
const BasePdfConverter = require('./BasePdfConverter');

// Initialize fetch with dynamic import
let fetchModule = null;

// Initialize fetch immediately
const initializeFetch = async () => {
  try {
    fetchModule = await Promise.resolve().then(() => _interopRequireWildcard(require('node-fetch')));
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
  async handleConvert(event, {
    filePath,
    options = {}
  }) {
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
      window.webContents.send('pdf:conversion-started', {
        conversionId
      });

      // Start conversion process
      this.processConversion(conversionId, filePath, options).catch(error => {
        console.error(`[MistralPdfConverter] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });

        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[MistralPdfConverter] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });
      return {
        conversionId
      };
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
  async handleGetMetadata(event, {
    filePath
  }) {
    try {
      // For metadata, we can use the standard PDF parser
      const standardConverter = new (require('./StandardPdfConverter'))(this.fileProcessor, this.fileStorage);
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
        return {
          valid: false,
          error: 'API key not configured'
        };
      }

      // Make a simple request to check if the API key is valid
      // Use the models endpoint from Mistral API
      const response = await fetchWithRetry('https://api.mistral.ai/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        return {
          valid: true
        };
      } else {
        // Read response as text first to avoid JSON parsing errors with non-JSON error responses
        const responseText = await response.text();
        console.error(`[MistralPdfConverter] API key check error (${response.status}): ${responseText.substring(0, 500)}`);

        // Try to parse as JSON if it looks like JSON
        let errorMessage = 'Invalid API key';
        try {
          if (responseText.trim().startsWith('{')) {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = errorJson.error.message;
            }
          }
        } catch (parseError) {
          console.error('[MistralPdfConverter] Could not parse error response as JSON:', parseError.message);
        }
        return {
          valid: false,
          error: errorMessage
        };
      }
    } catch (error) {
      console.error('[MistralPdfConverter] API key check failed:', error);
      return {
        valid: false,
        error: error.message
      };
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
      this.updateConversionStatus(conversionId, 'extracting_metadata', {
        progress: 5
      });
      const standardConverter = new (require('./StandardPdfConverter'))(this.fileProcessor, this.fileStorage);
      const metadata = await standardConverter.extractMetadata(filePath);

      // Process with OCR
      this.updateConversionStatus(conversionId, 'processing_ocr', {
        progress: 10
      });
      const ocrResult = await this.processWithOcr(filePath, options);

      // Generate markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 90
      });
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
    const fileUploadUrl = 'https://api.mistral.ai/v1/files';
    const getSignedUrlBase = 'https://api.mistral.ai/v1/files';
    const ocrEndpoint = this.apiEndpoint; // Use the existing endpoint for OCR
    const fileName = path.basename(filePath);
    try {
      console.log('[MistralPdfConverter] Processing PDF with OCR using Mistral API (File Upload Workflow)');

      // --- Step 1: Upload the file ---
      console.log(`[MistralPdfConverter] Uploading file: ${fileName}`);
      const fileBuffer = await fs.readFile(filePath);
      const formData = new FormData();
      formData.append('purpose', 'ocr');
      formData.append('file', fileBuffer, fileName);
      const uploadResponse = await fetchWithRetry(fileUploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders() // Let FormData set the Content-Type
        },
        body: formData
      });
      if (!uploadResponse.ok) {
        const responseText = await uploadResponse.text();
        console.error(`[MistralPdfConverter] File upload failed (${uploadResponse.status}): ${responseText.substring(0, 500)}`);
        throw new Error(`Mistral file upload failed (${uploadResponse.status}): ${responseText}`);
      }
      const uploadedFileData = await uploadResponse.json();
      const fileId = uploadedFileData.id;
      console.log(`[MistralPdfConverter] File uploaded successfully. File ID: ${fileId}`);

      // --- Step 2: Get Signed URL ---
      console.log(`[MistralPdfConverter] Getting signed URL for file ID: ${fileId}`);
      const getSignedUrlEndpoint = `${getSignedUrlBase}/${fileId}/url`;
      const signedUrlResponse = await fetchWithRetry(getSignedUrlEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      if (!signedUrlResponse.ok) {
        const responseText = await signedUrlResponse.text();
        console.error(`[MistralPdfConverter] Get signed URL failed (${signedUrlResponse.status}): ${responseText.substring(0, 500)}`);
        throw new Error(`Mistral get signed URL failed (${signedUrlResponse.status}): ${responseText}`);
      }
      const signedUrlData = await signedUrlResponse.json();
      const documentUrl = signedUrlData.url;
      console.log(`[MistralPdfConverter] Signed URL obtained: ${documentUrl.substring(0, 100)}...`);

      // --- Step 3: Call OCR API with Signed URL ---
      console.log('[MistralPdfConverter] Calling OCR API with signed URL');
      const requestBody = {
        model: "mistral-ocr-latest",
        document: {
          type: "document_url",
          document_url: documentUrl
        },
        include_image_base64: false
      };
      const ocrResponse = await fetchWithRetry(ocrEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      if (!ocrResponse.ok) {
        // Read response as text first to avoid JSON parsing errors with non-JSON error responses
        const responseText = await ocrResponse.text();
        console.error(`[MistralPdfConverter] OCR API error (${ocrResponse.status}): ${responseText.substring(0, 500)}`);

        // Try to parse as JSON if it looks like JSON
        let errorMessage = `OCR request failed with status ${ocrResponse.status}`;
        let errorDetails = responseText;
        try {
          if (responseText.trim().startsWith('{')) {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = errorJson.error.message;
            }

            // Log the full error object for debugging
            console.error('[MistralPdfConverter] Parsed error response:', JSON.stringify(errorJson, null, 2));
            errorDetails = JSON.stringify(errorJson, null, 2);
          }
        } catch (parseError) {
          console.error('[MistralPdfConverter] Could not parse error response as JSON:', parseError.message);
        }

        // For 500 errors, provide more specific guidance
        if (ocrResponse.status === 500) {
          console.error('[MistralPdfConverter] Received 500 Internal Server Error from Mistral API');
          console.error('[MistralPdfConverter] This may be due to:');
          console.error('  - File size exceeding API limits (max 50MB)');
          console.error('  - Temporary API service issues');
          console.error('  - Malformed request structure');
          console.error('  - API rate limiting');
          errorMessage = `Mistral API Internal Server Error (500): ${errorMessage}. This may be due to file size limits (max 50MB), API service issues, or rate limiting.`;
        }
        throw new Error(`Mistral OCR API error (${ocrResponse.status}): ${errorMessage}`);
      }
      const result = await ocrResponse.json();
      return this.processOcrResult(result);
    } catch (error) {
      console.error('[MistralPdfConverter] OCR processing failed:', error);
      throw error;
    }
  }

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
      console.log('[MistralPdfConverter] OCR result structure:', Object.keys(result).join(', '));

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
      console.error('[MistralPdfConverter] OCR result that caused error:', result ? JSON.stringify(result, null, 2).substring(0, 500) + '...' : 'undefined');

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
          pages = [{
            text: result
          }];
        } else if (result && result.text && typeof result.text === 'string') {
          pages = [{
            text: result.text
          }];
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
      const fallbackMarkdown = ['# OCR Conversion Result', '', '## Error Information', '', `An error occurred during markdown generation: ${error.message}`, '', '## Document Information', ''];

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
        // Use the correct model name from Mistral API documentation
        model: "mistral-ocr-latest",
        language: options.language
      });

      // Log OCR result structure for debugging
      console.log('[MistralPdfConverter] OCR result structure:', ocrResult ? Object.keys(ocrResult).join(', ') : 'null');
      console.log('[MistralPdfConverter] OCR pages count:', ocrResult && ocrResult.pages ? ocrResult.pages.length : 0);

      // Get current datetime
      const now = new Date();
      const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

      // Get the title from metadata or filename
      const fileTitle = metadata.title || options.name || 'PDF Document';

      // Create standardized frontmatter
      const frontmatter = ['---', `title: ${fileTitle}`, `converted: ${convertedDate}`, 'type: pdf-ocr', '---', ''].join('\n');

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
        await fs.remove(tempDir).catch(err => console.error('[MistralPdfConverter] Error cleaning up temp directory:', err));
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
      const errorDetails = error.response ? `API response: ${JSON.stringify(error.response.data || {})}` : error.message;

      // Check if this is a 500 Internal Server Error
      let errorMessage = error.message;
      let troubleshootingInfo = '';
      if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
        console.error('[MistralPdfConverter] Detected 500 Internal Server Error');

        // Add troubleshooting information for 500 errors
        troubleshootingInfo = `
## Troubleshooting 500 Internal Server Error

This error may be caused by:

1. **File Size Limit**: The PDF file may exceed Mistral's 50MB size limit.
2. **API Service Issues**: Mistral's API may be experiencing temporary issues.
3. **Rate Limiting**: You may have exceeded the API rate limits.
4. **Malformed Request**: The request format may not match Mistral's API requirements.

### Suggested Actions:
- Try with a smaller PDF file
- Check if your Mistral API key has sufficient permissions
- Try again later if it's a temporary service issue
- Verify your API subscription status
`;
      }
      return {
        success: false,
        error: `PDF OCR conversion failed: ${errorMessage}`,
        errorDetails: errorDetails,
        content: `# Conversion Error\n\nFailed to convert PDF with OCR: ${errorMessage}\n\n## Error Details\n\n${errorDetails}\n\n${troubleshootingInfo}`
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
        model: 'OCR model to use (default: mistral-ocr-latest)',
        language: 'Language hint for OCR (optional)',
        maxPages: 'Maximum pages to convert (default: all)'
      }
    };
  }
}
module.exports = MistralPdfConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiRm9ybURhdGEiLCJ2NCIsInV1aWR2NCIsIkJhc2VQZGZDb252ZXJ0ZXIiLCJmZXRjaE1vZHVsZSIsImluaXRpYWxpemVGZXRjaCIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsIl9pbnRlcm9wUmVxdWlyZVdpbGRjYXJkIiwiY29uc29sZSIsImxvZyIsImVycm9yIiwiZmV0Y2hQcm9taXNlIiwiZmV0Y2hXaXRoUmV0cnkiLCJ1cmwiLCJvcHRpb25zIiwiZGVmYXVsdCIsIk1pc3RyYWxQZGZDb252ZXJ0ZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVQcm9jZXNzb3IiLCJmaWxlU3RvcmFnZSIsIm9wZW5BSVByb3h5Iiwic2tpcEhhbmRsZXJTZXR1cCIsIm5hbWUiLCJkZXNjcmlwdGlvbiIsImFwaUVuZHBvaW50IiwicHJvY2VzcyIsImVudiIsIk1JU1RSQUxfQVBJX0VORFBPSU5UIiwiYXBpS2V5IiwiTUlTVFJBTF9BUElfS0VZIiwic2V0dXBJcGNIYW5kbGVycyIsInJlZ2lzdGVySGFuZGxlciIsImhhbmRsZUNvbnZlcnQiLCJiaW5kIiwiaGFuZGxlR2V0TWV0YWRhdGEiLCJoYW5kbGVDaGVja0FwaUtleSIsImV2ZW50IiwiZmlsZVBhdGgiLCJoYXNBcGlLZXkiLCJoYXNPcHRpb25zQXBpS2V5IiwibWlzdHJhbEFwaUtleSIsImZpbGVOYW1lIiwiYmFzZW5hbWUiLCJFcnJvciIsImNvbnZlcnNpb25JZCIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwid2luZG93Iiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJhY3RpdmVDb252ZXJzaW9ucyIsInNldCIsImlkIiwic3RhdHVzIiwicHJvZ3Jlc3MiLCJ3ZWJDb250ZW50cyIsInNlbmQiLCJwcm9jZXNzQ29udmVyc2lvbiIsImNhdGNoIiwidXBkYXRlQ29udmVyc2lvblN0YXR1cyIsIm1lc3NhZ2UiLCJyZW1vdmUiLCJlcnIiLCJzdGFuZGFyZENvbnZlcnRlciIsIm1ldGFkYXRhIiwiZXh0cmFjdE1ldGFkYXRhIiwidmFsaWQiLCJyZXNwb25zZSIsIm1ldGhvZCIsImhlYWRlcnMiLCJvayIsInJlc3BvbnNlVGV4dCIsInRleHQiLCJzdWJzdHJpbmciLCJlcnJvck1lc3NhZ2UiLCJ0cmltIiwic3RhcnRzV2l0aCIsImVycm9ySnNvbiIsIkpTT04iLCJwYXJzZSIsInBhcnNlRXJyb3IiLCJjb252ZXJzaW9uIiwiZ2V0Iiwib2NyUmVzdWx0IiwicHJvY2Vzc1dpdGhPY3IiLCJtYXJrZG93biIsImdlbmVyYXRlTWFya2Rvd24iLCJyZXN1bHQiLCJmaWxlVXBsb2FkVXJsIiwiZ2V0U2lnbmVkVXJsQmFzZSIsIm9jckVuZHBvaW50IiwiZmlsZUJ1ZmZlciIsInJlYWRGaWxlIiwiZm9ybURhdGEiLCJhcHBlbmQiLCJ1cGxvYWRSZXNwb25zZSIsImdldEhlYWRlcnMiLCJib2R5IiwidXBsb2FkZWRGaWxlRGF0YSIsImpzb24iLCJmaWxlSWQiLCJnZXRTaWduZWRVcmxFbmRwb2ludCIsInNpZ25lZFVybFJlc3BvbnNlIiwic2lnbmVkVXJsRGF0YSIsImRvY3VtZW50VXJsIiwicmVxdWVzdEJvZHkiLCJtb2RlbCIsImRvY3VtZW50IiwidHlwZSIsImRvY3VtZW50X3VybCIsImluY2x1ZGVfaW1hZ2VfYmFzZTY0Iiwib2NyUmVzcG9uc2UiLCJzdHJpbmdpZnkiLCJlcnJvckRldGFpbHMiLCJwcm9jZXNzT2NyUmVzdWx0IiwiT2JqZWN0Iiwia2V5cyIsImpvaW4iLCJkb2N1bWVudEluZm8iLCJsYW5ndWFnZSIsInByb2Nlc3NpbmdUaW1lIiwicHJvY2Vzc2luZ190aW1lIiwib3ZlcmFsbENvbmZpZGVuY2UiLCJjb25maWRlbmNlIiwidXNhZ2UiLCJwYWdlcyIsIkFycmF5IiwiaXNBcnJheSIsImRhdGEiLCJjb250ZW50IiwicGFnZV9udW1iZXIiLCJsZW5ndGgiLCJwcm9jZXNzZWRQYWdlcyIsIm1hcCIsInBhZ2UiLCJpbmRleCIsInBhZ2VOdW1iZXIiLCJwcm9jZXNzZWRQYWdlIiwid2lkdGgiLCJkaW1lbnNpb25zIiwiaGVpZ2h0IiwiYmxvY2tzIiwidGV4dEJsb2NrcyIsInByb2Nlc3NDb250ZW50QmxvY2tzIiwiZWxlbWVudHMiLCJlbGVtZW50IiwiZmlsdGVyIiwiZmFsbGJhY2tFcnJvciIsImJsb2NrIiwidG9Mb3dlckNhc2UiLCJwcm9jZXNzSGVhZGluZyIsInByb2Nlc3NQYXJhZ3JhcGgiLCJwcm9jZXNzTGlzdCIsInByb2Nlc3NUYWJsZSIsInByb2Nlc3NJbWFnZSIsInByb2Nlc3NDb2RlQmxvY2siLCJwcm9jZXNzUXVvdGUiLCJsZXZlbCIsImhlYWRpbmdNYXJrZXJzIiwicmVwZWF0IiwiTWF0aCIsIm1pbiIsIml0ZW1zIiwibGlzdFR5cGUiLCJvcmRlcmVkIiwiaXRlbSIsInJvd3MiLCJ0YWJsZVJvd3MiLCJyb3ciLCJjZWxscyIsImNlbGwiLCJoZWFkZXJSb3ciLCJzZXBhcmF0b3JDb3VudCIsIm1hdGNoIiwic2VwYXJhdG9yIiwic3BsaWNlIiwiY2FwdGlvbiIsImFsdCIsInNvdXJjZSIsInNyYyIsImNvZGUiLCJzcGxpdCIsImxpbmUiLCJnZW5lcmF0ZU1hcmtkb3duSGVhZGVyIiwicHVzaCIsImRvY0luZm8iLCJjb25maWRlbmNlUGVyY2VudCIsInJvdW5kIiwidG90YWxfdG9rZW5zIiwicHJvbXB0X3Rva2VucyIsImNvbXBsZXRpb25fdG9rZW5zIiwiZm9yRWFjaCIsInBhZ2VDb250ZW50IiwiZmFsbGJhY2tNYXJrZG93biIsInRpdGxlIiwiYXV0aG9yIiwic3ViamVjdCIsImtleXdvcmRzIiwiY3JlYXRvciIsInByb2R1Y2VyIiwiY3JlYXRpb25EYXRlIiwibW9kaWZpY2F0aW9uRGF0ZSIsImNvbnZlcnRUb01hcmtkb3duIiwib3JpZ2luYWxBcGlLZXkiLCJta2R0ZW1wIiwidG1wZGlyIiwidGVtcEZpbGUiLCJ3cml0ZUZpbGUiLCJTdGFuZGFyZFBkZkNvbnZlcnRlciIsInBhZ2VDb3VudCIsIm5vdyIsIkRhdGUiLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJyZXBsYWNlIiwiZmlsZVRpdGxlIiwiZnJvbnRtYXR0ZXIiLCJtYXJrZG93bkNvbnRlbnQiLCJmaW5hbE1hcmtkb3duIiwic3VjY2VzcyIsIm9jckluZm8iLCJjbGVhbnVwRXJyb3IiLCJ0cm91Ymxlc2hvb3RpbmdJbmZvIiwiaW5jbHVkZXMiLCJnZXRJbmZvIiwiZXh0ZW5zaW9ucyIsInN1cHBvcnRlZEV4dGVuc2lvbnMiLCJtYXhQYWdlcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9NaXN0cmFsUGRmQ29udmVydGVyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBNaXN0cmFsUGRmQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBQREYgZmlsZXMgdG8gbWFya2Rvd24gdXNpbmcgTWlzdHJhbCBPQ1IuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBVc2VzIE1pc3RyYWwgQUkgZm9yIE9DUiBwcm9jZXNzaW5nIG9mIFBERiBkb2N1bWVudHNcclxuICogLSBIYW5kbGVzIHNjYW5uZWQgZG9jdW1lbnRzIGFuZCBpbWFnZXMgd2l0aGluIFBERnNcclxuICogLSBFeHRyYWN0cyB0ZXh0IHRoYXQgc3RhbmRhcmQgUERGIHBhcnNlcnMgbWlnaHQgbWlzc1xyXG4gKiAtIENyZWF0ZXMgc3RydWN0dXJlZCBtYXJrZG93biB3aXRoIGhpZ2gtcXVhbGl0eSB0ZXh0IGV4dHJhY3Rpb25cclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gQmFzZVBkZkNvbnZlcnRlci5qczogUGFyZW50IGNsYXNzIHdpdGggY29tbW9uIFBERiBmdW5jdGlvbmFsaXR5XHJcbiAqIC0gU3RhbmRhcmRQZGZDb252ZXJ0ZXIuanM6IEFsdGVybmF0aXZlIHRleHQtYmFzZWQgY29udmVydGVyXHJcbiAqIC0gRmlsZVN0b3JhZ2VTZXJ2aWNlLmpzOiBGb3IgdGVtcG9yYXJ5IGZpbGUgbWFuYWdlbWVudFxyXG4gKiAtIFBkZkNvbnZlcnRlckZhY3RvcnkuanM6IEZhY3RvcnkgZm9yIHNlbGVjdGluZyBhcHByb3ByaWF0ZSBjb252ZXJ0ZXJcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IEZvcm1EYXRhID0gcmVxdWlyZSgnZm9ybS1kYXRhJyk7XHJcbmNvbnN0IHsgdjQ6IHV1aWR2NCB9ID0gcmVxdWlyZSgndXVpZCcpO1xyXG5jb25zdCBCYXNlUGRmQ29udmVydGVyID0gcmVxdWlyZSgnLi9CYXNlUGRmQ29udmVydGVyJyk7XHJcblxyXG4vLyBJbml0aWFsaXplIGZldGNoIHdpdGggZHluYW1pYyBpbXBvcnRcclxubGV0IGZldGNoTW9kdWxlID0gbnVsbDtcclxuXHJcbi8vIEluaXRpYWxpemUgZmV0Y2ggaW1tZWRpYXRlbHlcclxuY29uc3QgaW5pdGlhbGl6ZUZldGNoID0gYXN5bmMgKCkgPT4ge1xyXG4gIHRyeSB7XHJcbiAgICBmZXRjaE1vZHVsZSA9IGF3YWl0IGltcG9ydCgnbm9kZS1mZXRjaCcpO1xyXG4gICAgY29uc29sZS5sb2coJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBub2RlLWZldGNoIGxvYWRlZCBzdWNjZXNzZnVsbHknKTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIEZhaWxlZCB0byBsb2FkIG5vZGUtZmV0Y2g6JywgZXJyb3IpO1xyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG59O1xyXG5cclxuLy8gU3RhcnQgbG9hZGluZyBpbW1lZGlhdGVseVxyXG5jb25zdCBmZXRjaFByb21pc2UgPSBpbml0aWFsaXplRmV0Y2goKTtcclxuXHJcbi8vIENyZWF0ZSBhIHdyYXBwZXIgZnVuY3Rpb24gdG8gZW5zdXJlIGZldGNoIGlzIGF2YWlsYWJsZVxyXG5jb25zdCBmZXRjaFdpdGhSZXRyeSA9IGFzeW5jICh1cmwsIG9wdGlvbnMpID0+IHtcclxuICAvLyBXYWl0IGZvciBmZXRjaCB0byBiZSBsb2FkZWQgaWYgaXQncyBub3QgcmVhZHkgeWV0XHJcbiAgaWYgKCFmZXRjaE1vZHVsZSkge1xyXG4gICAgYXdhaXQgZmV0Y2hQcm9taXNlO1xyXG4gIH1cclxuICBcclxuICAvLyBVc2UgdGhlIGRlZmF1bHQgZXhwb3J0IGZyb20gdGhlIG1vZHVsZVxyXG4gIHJldHVybiBmZXRjaE1vZHVsZS5kZWZhdWx0KHVybCwgb3B0aW9ucyk7XHJcbn07XHJcblxyXG5jbGFzcyBNaXN0cmFsUGRmQ29udmVydGVyIGV4dGVuZHMgQmFzZVBkZkNvbnZlcnRlciB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSwgb3BlbkFJUHJveHksIHNraXBIYW5kbGVyU2V0dXAgPSBmYWxzZSkge1xyXG4gICAgICAgIHN1cGVyKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKTtcclxuICAgICAgICB0aGlzLm9wZW5BSVByb3h5ID0gb3BlbkFJUHJveHk7XHJcbiAgICAgICAgdGhpcy5uYW1lID0gJ01pc3RyYWwgUERGIENvbnZlcnRlcic7XHJcbiAgICAgICAgdGhpcy5kZXNjcmlwdGlvbiA9ICdDb252ZXJ0cyBQREYgZmlsZXMgdG8gbWFya2Rvd24gdXNpbmcgTWlzdHJhbCBPQ1InO1xyXG4gICAgICAgIHRoaXMuYXBpRW5kcG9pbnQgPSBwcm9jZXNzLmVudi5NSVNUUkFMX0FQSV9FTkRQT0lOVCB8fCAnaHR0cHM6Ly9hcGkubWlzdHJhbC5haS92MS9vY3InO1xyXG4gICAgICAgIHRoaXMuYXBpS2V5ID0gcHJvY2Vzcy5lbnYuTUlTVFJBTF9BUElfS0VZO1xyXG4gICAgICAgIHRoaXMuc2tpcEhhbmRsZXJTZXR1cCA9IHNraXBIYW5kbGVyU2V0dXA7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTG9nIHdoZXRoZXIgaGFuZGxlcnMgd2lsbCBiZSBzZXQgdXBcclxuICAgICAgICBpZiAoc2tpcEhhbmRsZXJTZXR1cCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIFNraXBwaW5nIGhhbmRsZXIgc2V0dXAgKHNraXBIYW5kbGVyU2V0dXA9dHJ1ZSknKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLnNldHVwSXBjSGFuZGxlcnMoKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBQREYgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gU2V0dGluZyB1cCBJUEMgaGFuZGxlcnMnKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwZGY6b2NyJywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBkZjpvY3I6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBkZjpvY3I6Y2hlY2snLCB0aGlzLmhhbmRsZUNoZWNrQXBpS2V5LmJpbmQodGhpcykpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gSVBDIGhhbmRsZXJzIHJlZ2lzdGVyZWQnKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBQREYgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyBmaWxlUGF0aCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIGhhbmRsZUNvbnZlcnQgY2FsbGVkIHdpdGggb3B0aW9uczonLCB7XHJcbiAgICAgICAgICAgICAgICBoYXNBcGlLZXk6ICEhdGhpcy5hcGlLZXksXHJcbiAgICAgICAgICAgICAgICBoYXNPcHRpb25zQXBpS2V5OiAhIW9wdGlvbnMubWlzdHJhbEFwaUtleSxcclxuICAgICAgICAgICAgICAgIGZpbGVOYW1lOiBvcHRpb25zLm5hbWUgfHwgcGF0aC5iYXNlbmFtZShmaWxlUGF0aClcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBVc2UgQVBJIGtleSBmcm9tIG9wdGlvbnMgaWYgYXZhaWxhYmxlLCBvdGhlcndpc2UgdXNlIHRoZSBvbmUgZnJvbSB0aGUgaW5zdGFuY2VcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMubWlzdHJhbEFwaUtleSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBVc2luZyBBUEkga2V5IGZyb20gb3B0aW9ucycpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy5hcGlLZXkgPSBvcHRpb25zLm1pc3RyYWxBcGlLZXk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENoZWNrIGlmIEFQSSBrZXkgaXMgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5hcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWlzdHJhbCBBUEkga2V5IG5vdCBjb25maWd1cmVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncGRmX29jcl9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIGZpbGVQYXRoLFxyXG4gICAgICAgICAgICAgICAgdGVtcERpcixcclxuICAgICAgICAgICAgICAgIHdpbmRvd1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIE5vdGlmeSBjbGllbnQgdGhhdCBjb252ZXJzaW9uIGhhcyBzdGFydGVkXHJcbiAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwZGY6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQgZm9yICR7Y29udmVyc2lvbklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZmFpbGVkJywgeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIGZzLnJlbW92ZSh0ZW1wRGlyKS5jYXRjaChlcnIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNaXN0cmFsUGRmQ29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udmVyc2lvbklkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFBERiBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IGZpbGVQYXRoIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBGb3IgbWV0YWRhdGEsIHdlIGNhbiB1c2UgdGhlIHN0YW5kYXJkIFBERiBwYXJzZXJcclxuICAgICAgICAgICAgY29uc3Qgc3RhbmRhcmRDb252ZXJ0ZXIgPSBuZXcgKHJlcXVpcmUoJy4vU3RhbmRhcmRQZGZDb252ZXJ0ZXInKSkoXHJcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IsXHJcbiAgICAgICAgICAgICAgICB0aGlzLmZpbGVTdG9yYWdlXHJcbiAgICAgICAgICAgICk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHN0YW5kYXJkQ29udmVydGVyLmV4dHJhY3RNZXRhZGF0YShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIHJldHVybiBtZXRhZGF0YTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBBUEkga2V5IGNoZWNrIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDaGVja0FwaUtleShldmVudCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5hcGlLZXkpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgZXJyb3I6ICdBUEkga2V5IG5vdCBjb25maWd1cmVkJyB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBNYWtlIGEgc2ltcGxlIHJlcXVlc3QgdG8gY2hlY2sgaWYgdGhlIEFQSSBrZXkgaXMgdmFsaWRcclxuICAgICAgICAgICAgLy8gVXNlIHRoZSBtb2RlbHMgZW5kcG9pbnQgZnJvbSBNaXN0cmFsIEFQSVxyXG4gICAgICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IGZldGNoV2l0aFJldHJ5KCdodHRwczovL2FwaS5taXN0cmFsLmFpL3YxL21vZGVscycsIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5hcGlLZXl9YCxcclxuICAgICAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHJlc3BvbnNlLm9rKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWxpZDogdHJ1ZSB9O1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gUmVhZCByZXNwb25zZSBhcyB0ZXh0IGZpcnN0IHRvIGF2b2lkIEpTT04gcGFyc2luZyBlcnJvcnMgd2l0aCBub24tSlNPTiBlcnJvciByZXNwb25zZXNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNaXN0cmFsUGRmQ29udmVydGVyXSBBUEkga2V5IGNoZWNrIGVycm9yICgke3Jlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX1gKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVHJ5IHRvIHBhcnNlIGFzIEpTT04gaWYgaXQgbG9va3MgbGlrZSBKU09OXHJcbiAgICAgICAgICAgICAgICBsZXQgZXJyb3JNZXNzYWdlID0gJ0ludmFsaWQgQVBJIGtleSc7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZVRleHQudHJpbSgpLnN0YXJ0c1dpdGgoJ3snKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvckpzb24gPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnJvckpzb24uZXJyb3IgJiYgZXJyb3JKc29uLmVycm9yLm1lc3NhZ2UpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZSA9IGVycm9ySnNvbi5lcnJvci5tZXNzYWdlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAocGFyc2VFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBDb3VsZCBub3QgcGFyc2UgZXJyb3IgcmVzcG9uc2UgYXMgSlNPTjonLCBwYXJzZUVycm9yLm1lc3NhZ2UpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGVycm9yOiBlcnJvck1lc3NhZ2UgfTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBBUEkga2V5IGNoZWNrIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIFBERiBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZVBhdGggLSBQYXRoIHRvIFBERiBmaWxlXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBwcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbi50ZW1wRGlyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZXh0cmFjdGluZ19tZXRhZGF0YScsIHsgcHJvZ3Jlc3M6IDUgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHN0YW5kYXJkQ29udmVydGVyID0gbmV3IChyZXF1aXJlKCcuL1N0YW5kYXJkUGRmQ29udmVydGVyJykpKFxyXG4gICAgICAgICAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yLFxyXG4gICAgICAgICAgICAgICAgdGhpcy5maWxlU3RvcmFnZVxyXG4gICAgICAgICAgICApO1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHN0YW5kYXJkQ29udmVydGVyLmV4dHJhY3RNZXRhZGF0YShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIHdpdGggT0NSXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX29jcicsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBvY3JSZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NXaXRoT2NyKGZpbGVQYXRoLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdnZW5lcmF0aW5nX21hcmtkb3duJywgeyBwcm9ncmVzczogOTAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBvY3JSZXN1bHQsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0OiBtYXJrZG93blxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgUERGIHdpdGggTWlzdHJhbCBPQ1JcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBmaWxlUGF0aCAtIFBhdGggdG8gUERGIGZpbGVcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBPQ1IgcmVzdWx0XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NXaXRoT2NyKGZpbGVQYXRoLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgZmlsZVVwbG9hZFVybCA9ICdodHRwczovL2FwaS5taXN0cmFsLmFpL3YxL2ZpbGVzJztcclxuICAgICAgICBjb25zdCBnZXRTaWduZWRVcmxCYXNlID0gJ2h0dHBzOi8vYXBpLm1pc3RyYWwuYWkvdjEvZmlsZXMnO1xyXG4gICAgICAgIGNvbnN0IG9jckVuZHBvaW50ID0gdGhpcy5hcGlFbmRwb2ludDsgLy8gVXNlIHRoZSBleGlzdGluZyBlbmRwb2ludCBmb3IgT0NSXHJcbiAgICAgICAgY29uc3QgZmlsZU5hbWUgPSBwYXRoLmJhc2VuYW1lKGZpbGVQYXRoKTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBQcm9jZXNzaW5nIFBERiB3aXRoIE9DUiB1c2luZyBNaXN0cmFsIEFQSSAoRmlsZSBVcGxvYWQgV29ya2Zsb3cpJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyAtLS0gU3RlcCAxOiBVcGxvYWQgdGhlIGZpbGUgLS0tXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gVXBsb2FkaW5nIGZpbGU6ICR7ZmlsZU5hbWV9YCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVCdWZmZXIgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZvcm1EYXRhID0gbmV3IEZvcm1EYXRhKCk7XHJcbiAgICAgICAgICAgIGZvcm1EYXRhLmFwcGVuZCgncHVycG9zZScsICdvY3InKTtcclxuICAgICAgICAgICAgZm9ybURhdGEuYXBwZW5kKCdmaWxlJywgZmlsZUJ1ZmZlciwgZmlsZU5hbWUpO1xyXG5cclxuICAgICAgICAgICAgY29uc3QgdXBsb2FkUmVzcG9uc2UgPSBhd2FpdCBmZXRjaFdpdGhSZXRyeShmaWxlVXBsb2FkVXJsLCB7XHJcbiAgICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLmFwaUtleX1gLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLmZvcm1EYXRhLmdldEhlYWRlcnMoKSAvLyBMZXQgRm9ybURhdGEgc2V0IHRoZSBDb250ZW50LVR5cGVcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBib2R5OiBmb3JtRGF0YVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIGlmICghdXBsb2FkUmVzcG9uc2Uub2spIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHVwbG9hZFJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNaXN0cmFsUGRmQ29udmVydGVyXSBGaWxlIHVwbG9hZCBmYWlsZWQgKCR7dXBsb2FkUmVzcG9uc2Uuc3RhdHVzfSk6ICR7cmVzcG9uc2VUZXh0LnN1YnN0cmluZygwLCA1MDApfWApO1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXN0cmFsIGZpbGUgdXBsb2FkIGZhaWxlZCAoJHt1cGxvYWRSZXNwb25zZS5zdGF0dXN9KTogJHtyZXNwb25zZVRleHR9YCk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGNvbnN0IHVwbG9hZGVkRmlsZURhdGEgPSBhd2FpdCB1cGxvYWRSZXNwb25zZS5qc29uKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVJZCA9IHVwbG9hZGVkRmlsZURhdGEuaWQ7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gRmlsZSB1cGxvYWRlZCBzdWNjZXNzZnVsbHkuIEZpbGUgSUQ6ICR7ZmlsZUlkfWApO1xyXG5cclxuICAgICAgICAgICAgLy8gLS0tIFN0ZXAgMjogR2V0IFNpZ25lZCBVUkwgLS0tXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gR2V0dGluZyBzaWduZWQgVVJMIGZvciBmaWxlIElEOiAke2ZpbGVJZH1gKTtcclxuICAgICAgICAgICAgY29uc3QgZ2V0U2lnbmVkVXJsRW5kcG9pbnQgPSBgJHtnZXRTaWduZWRVcmxCYXNlfS8ke2ZpbGVJZH0vdXJsYDtcclxuICAgICAgICAgICAgY29uc3Qgc2lnbmVkVXJsUmVzcG9uc2UgPSBhd2FpdCBmZXRjaFdpdGhSZXRyeShnZXRTaWduZWRVcmxFbmRwb2ludCwge1xyXG4gICAgICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcclxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLmFwaUtleX1gLFxyXG4gICAgICAgICAgICAgICAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICBpZiAoIXNpZ25lZFVybFJlc3BvbnNlLm9rKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCByZXNwb25zZVRleHQgPSBhd2FpdCBzaWduZWRVcmxSZXNwb25zZS50ZXh0KCk7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gR2V0IHNpZ25lZCBVUkwgZmFpbGVkICgke3NpZ25lZFVybFJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX1gKTtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzdHJhbCBnZXQgc2lnbmVkIFVSTCBmYWlsZWQgKCR7c2lnbmVkVXJsUmVzcG9uc2Uuc3RhdHVzfSk6ICR7cmVzcG9uc2VUZXh0fWApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICBjb25zdCBzaWduZWRVcmxEYXRhID0gYXdhaXQgc2lnbmVkVXJsUmVzcG9uc2UuanNvbigpO1xyXG4gICAgICAgICAgICBjb25zdCBkb2N1bWVudFVybCA9IHNpZ25lZFVybERhdGEudXJsO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW01pc3RyYWxQZGZDb252ZXJ0ZXJdIFNpZ25lZCBVUkwgb2J0YWluZWQ6ICR7ZG9jdW1lbnRVcmwuc3Vic3RyaW5nKDAsIDEwMCl9Li4uYCk7XHJcblxyXG4gICAgICAgICAgICAvLyAtLS0gU3RlcCAzOiBDYWxsIE9DUiBBUEkgd2l0aCBTaWduZWQgVVJMIC0tLVxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIENhbGxpbmcgT0NSIEFQSSB3aXRoIHNpZ25lZCBVUkwnKTtcclxuICAgICAgICAgICAgY29uc3QgcmVxdWVzdEJvZHkgPSB7XHJcbiAgICAgICAgICAgICAgICBtb2RlbDogXCJtaXN0cmFsLW9jci1sYXRlc3RcIixcclxuICAgICAgICAgICAgICAgIGRvY3VtZW50OiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHlwZTogXCJkb2N1bWVudF91cmxcIixcclxuICAgICAgICAgICAgICAgICAgICBkb2N1bWVudF91cmw6IGRvY3VtZW50VXJsXHJcbiAgICAgICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZV9pbWFnZV9iYXNlNjQ6IGZhbHNlXHJcbiAgICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgICBjb25zdCBvY3JSZXNwb25zZSA9IGF3YWl0IGZldGNoV2l0aFJldHJ5KG9jckVuZHBvaW50LCB7XHJcbiAgICAgICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLmFwaUtleX1gLFxyXG4gICAgICAgICAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0Qm9keSlcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoIW9jclJlc3BvbnNlLm9rKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBSZWFkIHJlc3BvbnNlIGFzIHRleHQgZmlyc3QgdG8gYXZvaWQgSlNPTiBwYXJzaW5nIGVycm9ycyB3aXRoIG5vbi1KU09OIGVycm9yIHJlc3BvbnNlc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gYXdhaXQgb2NyUmVzcG9uc2UudGV4dCgpO1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE9DUiBBUEkgZXJyb3IgKCR7b2NyUmVzcG9uc2Uuc3RhdHVzfSk6ICR7cmVzcG9uc2VUZXh0LnN1YnN0cmluZygwLCA1MDApfWApO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBUcnkgdG8gcGFyc2UgYXMgSlNPTiBpZiBpdCBsb29rcyBsaWtlIEpTT05cclxuICAgICAgICAgICAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSBgT0NSIHJlcXVlc3QgZmFpbGVkIHdpdGggc3RhdHVzICR7b2NyUmVzcG9uc2Uuc3RhdHVzfWA7XHJcbiAgICAgICAgICAgICAgICBsZXQgZXJyb3JEZXRhaWxzID0gcmVzcG9uc2VUZXh0O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmIChyZXNwb25zZVRleHQudHJpbSgpLnN0YXJ0c1dpdGgoJ3snKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnJvckpzb24gPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChlcnJvckpzb24uZXJyb3IgJiYgZXJyb3JKc29uLmVycm9yLm1lc3NhZ2UpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZSA9IGVycm9ySnNvbi5lcnJvci5tZXNzYWdlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBMb2cgdGhlIGZ1bGwgZXJyb3Igb2JqZWN0IGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIFBhcnNlZCBlcnJvciByZXNwb25zZTonLCBKU09OLnN0cmluZ2lmeShlcnJvckpzb24sIG51bGwsIDIpKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXJyb3JEZXRhaWxzID0gSlNPTi5zdHJpbmdpZnkoZXJyb3JKc29uLCBudWxsLCAyKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9IGNhdGNoIChwYXJzZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIENvdWxkIG5vdCBwYXJzZSBlcnJvciByZXNwb25zZSBhcyBKU09OOicsIHBhcnNlRXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEZvciA1MDAgZXJyb3JzLCBwcm92aWRlIG1vcmUgc3BlY2lmaWMgZ3VpZGFuY2VcclxuICAgICAgICAgICAgICAgIGlmIChvY3JSZXNwb25zZS5zdGF0dXMgPT09IDUwMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBSZWNlaXZlZCA1MDAgSW50ZXJuYWwgU2VydmVyIEVycm9yIGZyb20gTWlzdHJhbCBBUEknKTtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gVGhpcyBtYXkgYmUgZHVlIHRvOicpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJyAgLSBGaWxlIHNpemUgZXhjZWVkaW5nIEFQSSBsaW1pdHMgKG1heCA1ME1CKScpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJyAgLSBUZW1wb3JhcnkgQVBJIHNlcnZpY2UgaXNzdWVzJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignICAtIE1hbGZvcm1lZCByZXF1ZXN0IHN0cnVjdHVyZScpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJyAgLSBBUEkgcmF0ZSBsaW1pdGluZycpO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGVycm9yTWVzc2FnZSA9IGBNaXN0cmFsIEFQSSBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3IgKDUwMCk6ICR7ZXJyb3JNZXNzYWdlfS4gVGhpcyBtYXkgYmUgZHVlIHRvIGZpbGUgc2l6ZSBsaW1pdHMgKG1heCA1ME1CKSwgQVBJIHNlcnZpY2UgaXNzdWVzLCBvciByYXRlIGxpbWl0aW5nLmA7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzdHJhbCBPQ1IgQVBJIGVycm9yICgke29jclJlc3BvbnNlLnN0YXR1c30pOiAke2Vycm9yTWVzc2FnZX1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb2NyUmVzcG9uc2UuanNvbigpO1xyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzT2NyUmVzdWx0KHJlc3VsdCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE9DUiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgT0NSIHJlc3VsdCBmcm9tIE1pc3RyYWwgQVBJXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVzdWx0IC0gT0NSIEFQSSByZXN1bHRcclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IFByb2Nlc3NlZCByZXN1bHQgd2l0aCBzdHJ1Y3R1cmVkIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgcHJvY2Vzc09jclJlc3VsdChyZXN1bHQpIHtcclxuICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgT0NSIHJlc3VsdCcpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICghcmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VtcHR5IE9DUiByZXN1bHQgcmVjZWl2ZWQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTG9nIHRoZSBzdHJ1Y3R1cmUgb2YgdGhlIHJlc3VsdCBmb3IgZGVidWdnaW5nXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gT0NSIHJlc3VsdCBzdHJ1Y3R1cmU6JyxcclxuICAgICAgICAgICAgICAgIE9iamVjdC5rZXlzKHJlc3VsdCkuam9pbignLCAnKSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGRvY3VtZW50LWxldmVsIGluZm9ybWF0aW9uXHJcbiAgICAgICAgICAgIGNvbnN0IGRvY3VtZW50SW5mbyA9IHtcclxuICAgICAgICAgICAgICAgIG1vZGVsOiByZXN1bHQubW9kZWwgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IHJlc3VsdC5sYW5ndWFnZSB8fCAndW5rbm93bicsXHJcbiAgICAgICAgICAgICAgICBwcm9jZXNzaW5nVGltZTogcmVzdWx0LnByb2Nlc3NpbmdfdGltZSB8fCAwLFxyXG4gICAgICAgICAgICAgICAgb3ZlcmFsbENvbmZpZGVuY2U6IHJlc3VsdC5jb25maWRlbmNlIHx8IDAsXHJcbiAgICAgICAgICAgICAgICB1c2FnZTogcmVzdWx0LnVzYWdlIHx8IG51bGxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZXMgYmFzZWQgb24gTWlzdHJhbCBPQ1IgQVBJIHJlc3BvbnNlIGZvcm1hdFxyXG4gICAgICAgICAgICBsZXQgcGFnZXMgPSBbXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEhhbmRsZSBkaWZmZXJlbnQgcmVzcG9uc2UgZm9ybWF0c1xyXG4gICAgICAgICAgICBpZiAocmVzdWx0LnBhZ2VzICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LnBhZ2VzKSkge1xyXG4gICAgICAgICAgICAgICAgLy8gU3RhbmRhcmQgZm9ybWF0IHdpdGggcGFnZXMgYXJyYXlcclxuICAgICAgICAgICAgICAgIHBhZ2VzID0gcmVzdWx0LnBhZ2VzO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3VsdC5kYXRhICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBBbHRlcm5hdGl2ZSBmb3JtYXQgd2l0aCBkYXRhIGFycmF5XHJcbiAgICAgICAgICAgICAgICBwYWdlcyA9IHJlc3VsdC5kYXRhO1xyXG4gICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3VsdC5jb250ZW50ICYmIHR5cGVvZiByZXN1bHQuY29udGVudCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgICAgIC8vIFNpbXBsZSBmb3JtYXQgd2l0aCBqdXN0IGNvbnRlbnQgc3RyaW5nXHJcbiAgICAgICAgICAgICAgICBwYWdlcyA9IFt7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZV9udW1iZXI6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcmVzdWx0LmNvbnRlbnQsXHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogcmVzdWx0LmNvbmZpZGVuY2UgfHwgMFxyXG4gICAgICAgICAgICAgICAgfV07XHJcbiAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzdWx0LnRleHQgJiYgdHlwZW9mIHJlc3VsdC50ZXh0ID09PSAnc3RyaW5nJykge1xyXG4gICAgICAgICAgICAgICAgLy8gQW5vdGhlciBzaW1wbGUgZm9ybWF0IHdpdGgganVzdCB0ZXh0XHJcbiAgICAgICAgICAgICAgICBwYWdlcyA9IFt7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZV9udW1iZXI6IDEsXHJcbiAgICAgICAgICAgICAgICAgICAgdGV4dDogcmVzdWx0LnRleHQsXHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogcmVzdWx0LmNvbmZpZGVuY2UgfHwgMFxyXG4gICAgICAgICAgICAgICAgfV07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gUHJvY2Vzc2luZyAke3BhZ2VzLmxlbmd0aH0gcGFnZXMgZnJvbSBPQ1IgcmVzdWx0YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBwcm9jZXNzZWRQYWdlcyA9IHBhZ2VzLm1hcCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgIC8vIEJhc2ljIHBhZ2UgaW5mb3JtYXRpb24gd2l0aCBmYWxsYmFja3NcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VOdW1iZXIgPSBwYWdlLnBhZ2VfbnVtYmVyIHx8IHBhZ2UucGFnZU51bWJlciB8fCBpbmRleCArIDE7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9jZXNzZWRQYWdlID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VOdW1iZXIsXHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlkZW5jZTogcGFnZS5jb25maWRlbmNlIHx8IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgd2lkdGg6IHBhZ2Uud2lkdGggfHwgcGFnZS5kaW1lbnNpb25zPy53aWR0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGhlaWdodDogcGFnZS5oZWlnaHQgfHwgcGFnZS5kaW1lbnNpb25zPy5oZWlnaHQgfHwgMCxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiAnJ1xyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gUHJvY2VzcyBzdHJ1Y3R1cmVkIGNvbnRlbnQgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICBpZiAocGFnZS5ibG9ja3MgJiYgQXJyYXkuaXNBcnJheShwYWdlLmJsb2NrcykpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIGJsb2NrcyAocGFyYWdyYXBocywgaGVhZGluZ3MsIGxpc3RzLCB0YWJsZXMsIGV0Yy4pXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGV4dEJsb2NrcyA9IHRoaXMucHJvY2Vzc0NvbnRlbnRCbG9ja3MocGFnZS5ibG9ja3MpO1xyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IHRleHRCbG9ja3Muam9pbignXFxuXFxuJyk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBhZ2UuZWxlbWVudHMgJiYgQXJyYXkuaXNBcnJheShwYWdlLmVsZW1lbnRzKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIEFsdGVybmF0aXZlIHN0cnVjdHVyZSB3aXRoIGVsZW1lbnRzIGluc3RlYWQgb2YgYmxvY2tzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZWxlbWVudHMgPSBwYWdlLmVsZW1lbnRzLm1hcChlbGVtZW50ID0+IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnICYmIGVsZW1lbnQudGV4dCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQudGV4dDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChlbGVtZW50LmNvbnRlbnQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNvbnRlbnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgICAgICAgICAgIH0pLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IGVsZW1lbnRzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwYWdlLmNvbnRlbnQgJiYgdHlwZW9mIHBhZ2UuY29udGVudCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBTaW1wbGUgY29udGVudCBmaWVsZFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2UudGV4dCA9IHBhZ2UuY29udGVudDtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGFnZS50ZXh0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRmFsbGJhY2sgdG8gcmF3IHRleHQgaWYgc3RydWN0dXJlZCBjb250ZW50IGlzIG5vdCBhdmFpbGFibGVcclxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzZWRQYWdlLnRleHQgPSBwYWdlLnRleHQ7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJldHVybiBwcm9jZXNzZWRQYWdlO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbTWlzdHJhbFBkZkNvbnZlcnRlcl0gT0NSIHJlc3VsdCBwcm9jZXNzaW5nIGNvbXBsZXRlIGZvciAke3Byb2Nlc3NlZFBhZ2VzLmxlbmd0aH0gcGFnZXNgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBkb2N1bWVudEluZm8sXHJcbiAgICAgICAgICAgICAgICBwYWdlczogcHJvY2Vzc2VkUGFnZXNcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gRXJyb3IgcHJvY2Vzc2luZyBPQ1IgcmVzdWx0OicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb3ZpZGUgZGV0YWlsZWQgZXJyb3IgaW5mb3JtYXRpb25cclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE9DUiByZXN1bHQgdGhhdCBjYXVzZWQgZXJyb3I6JyxcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA/IEpTT04uc3RyaW5naWZ5KHJlc3VsdCwgbnVsbCwgMikuc3Vic3RyaW5nKDAsIDUwMCkgKyAnLi4uJyA6ICd1bmRlZmluZWQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZhbGxiYWNrIHRvIGJhc2ljIHByb2Nlc3NpbmcgaWYgYW4gZXJyb3Igb2NjdXJzXHJcbiAgICAgICAgICAgIGxldCBwYWdlcyA9IFtdO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIC8vIEF0dGVtcHQgdG8gZXh0cmFjdCBhbnkgdXNhYmxlIGluZm9ybWF0aW9uXHJcbiAgICAgICAgICAgICAgICBpZiAocmVzdWx0ICYmIHJlc3VsdC5wYWdlcyAmJiBBcnJheS5pc0FycmF5KHJlc3VsdC5wYWdlcykpIHtcclxuICAgICAgICAgICAgICAgICAgICBwYWdlcyA9IHJlc3VsdC5wYWdlcztcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzdWx0ICYmIHJlc3VsdC5kYXRhICYmIEFycmF5LmlzQXJyYXkocmVzdWx0LmRhdGEpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZXMgPSByZXN1bHQuZGF0YTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocmVzdWx0ICYmIHR5cGVvZiByZXN1bHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSGFuZGxlIGNhc2Ugd2hlcmUgcmVzdWx0IG1pZ2h0IGJlIGEgc3RyaW5nXHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZXMgPSBbeyB0ZXh0OiByZXN1bHQgfV07XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHJlc3VsdCAmJiByZXN1bHQudGV4dCAmJiB0eXBlb2YgcmVzdWx0LnRleHQgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcGFnZXMgPSBbeyB0ZXh0OiByZXN1bHQudGV4dCB9XTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSBjYXRjaCAoZmFsbGJhY2tFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIEZhbGxiYWNrIHByb2Nlc3NpbmcgYWxzbyBmYWlsZWQ6JywgZmFsbGJhY2tFcnJvcik7XHJcbiAgICAgICAgICAgICAgICBwYWdlcyA9IFtdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgZG9jdW1lbnRJbmZvOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgbW9kZWw6IHJlc3VsdD8ubW9kZWwgfHwgJ3Vua25vd24nLFxyXG4gICAgICAgICAgICAgICAgICAgIGxhbmd1YWdlOiByZXN1bHQ/Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcclxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIHBhZ2VzOiBwYWdlcy5tYXAoKHBhZ2UsIGluZGV4KSA9PiAoe1xyXG4gICAgICAgICAgICAgICAgICAgIHBhZ2VOdW1iZXI6IHBhZ2UucGFnZV9udW1iZXIgfHwgcGFnZS5wYWdlTnVtYmVyIHx8IGluZGV4ICsgMSxcclxuICAgICAgICAgICAgICAgICAgICB0ZXh0OiBwYWdlLnRleHQgfHwgcGFnZS5jb250ZW50IHx8ICcnLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IHBhZ2UuY29uZmlkZW5jZSB8fCAwXHJcbiAgICAgICAgICAgICAgICB9KSlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBjb250ZW50IGJsb2NrcyBmcm9tIE9DUiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IGJsb2NrcyAtIENvbnRlbnQgYmxvY2tzIGZyb20gT0NSXHJcbiAgICAgKiBAcmV0dXJucyB7QXJyYXl9IFByb2Nlc3NlZCB0ZXh0IGJsb2Nrc1xyXG4gICAgICovXHJcbiAgICBwcm9jZXNzQ29udGVudEJsb2NrcyhibG9ja3MpIHtcclxuICAgICAgICBpZiAoIUFycmF5LmlzQXJyYXkoYmxvY2tzKSB8fCBibG9ja3MubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBbXTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIGJsb2Nrcy5tYXAoYmxvY2sgPT4ge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgLy8gSGFuZGxlIGNhc2Ugd2hlcmUgYmxvY2sgbWlnaHQgYmUgYSBzdHJpbmdcclxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgYmxvY2sgPT09ICdzdHJpbmcnKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGJsb2NrO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBIYW5kbGUgY2FzZSB3aGVyZSBibG9jayBtaWdodCBoYXZlIGRpcmVjdCB0ZXh0IGNvbnRlbnRcclxuICAgICAgICAgICAgICAgIGlmICghYmxvY2sudHlwZSAmJiBibG9jay50ZXh0KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGJsb2NrLnRleHQ7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgZGlmZmVyZW50IHR5cGVzIG9mIGJsb2Nrc1xyXG4gICAgICAgICAgICAgICAgc3dpdGNoIChibG9jay50eXBlPy50b0xvd2VyQ2FzZSgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnaGVhZGluZyc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NIZWFkaW5nKGJsb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICdwYXJhZ3JhcGgnOlxyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ3RleHQnOlxyXG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5wcm9jZXNzUGFyYWdyYXBoKGJsb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICdsaXN0JzpcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICdidWxsZXRfbGlzdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnbnVtYmVyZWRfbGlzdCc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NMaXN0KGJsb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICd0YWJsZSc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NUYWJsZShibG9jayk7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnaW1hZ2UnOlxyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ2ZpZ3VyZSc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NJbWFnZShibG9jayk7XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnY29kZSc6XHJcbiAgICAgICAgICAgICAgICAgICAgY2FzZSAnY29kZV9ibG9jayc6XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLnByb2Nlc3NDb2RlQmxvY2soYmxvY2spO1xyXG4gICAgICAgICAgICAgICAgICAgIGNhc2UgJ3F1b3RlJzpcclxuICAgICAgICAgICAgICAgICAgICBjYXNlICdibG9ja3F1b3RlJzpcclxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMucHJvY2Vzc1F1b3RlKGJsb2NrKTtcclxuICAgICAgICAgICAgICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBGb3IgdW5rbm93biBibG9jayB0eXBlcywganVzdCByZXR1cm4gdGhlIHRleHQgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBibG9jay50ZXh0IHx8IGJsb2NrLmNvbnRlbnQgfHwgJyc7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gRXJyb3IgcHJvY2Vzc2luZyBjb250ZW50IGJsb2NrOicsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIC8vIFJldHVybiBlbXB0eSBzdHJpbmcgaWYgcHJvY2Vzc2luZyBmYWlsc1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuICcnO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSkuZmlsdGVyKHRleHQgPT4gdGV4dC50cmltKCkubGVuZ3RoID4gMCk7IC8vIEZpbHRlciBvdXQgZW1wdHkgYmxvY2tzXHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBoZWFkaW5nIGJsb2NrXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gYmxvY2sgLSBIZWFkaW5nIGJsb2NrXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBoZWFkaW5nXHJcbiAgICAgKi9cclxuICAgIHByb2Nlc3NIZWFkaW5nKGJsb2NrKSB7XHJcbiAgICAgICAgY29uc3QgbGV2ZWwgPSBibG9jay5sZXZlbCB8fCAxO1xyXG4gICAgICAgIGNvbnN0IGhlYWRpbmdNYXJrZXJzID0gJyMnLnJlcGVhdChNYXRoLm1pbihsZXZlbCwgNikpO1xyXG4gICAgICAgIHJldHVybiBgJHtoZWFkaW5nTWFya2Vyc30gJHtibG9jay50ZXh0IHx8ICcnfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBwYXJhZ3JhcGggYmxvY2tcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBibG9jayAtIFBhcmFncmFwaCBibG9ja1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gUGFyYWdyYXBoIHRleHRcclxuICAgICAqL1xyXG4gICAgcHJvY2Vzc1BhcmFncmFwaChibG9jaykge1xyXG4gICAgICAgIHJldHVybiBibG9jay50ZXh0IHx8ICcnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgbGlzdCBibG9ja1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gTGlzdCBibG9ja1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gbGlzdFxyXG4gICAgICovXHJcbiAgICBwcm9jZXNzTGlzdChibG9jaykge1xyXG4gICAgICAgIGlmICghYmxvY2suaXRlbXMgfHwgIUFycmF5LmlzQXJyYXkoYmxvY2suaXRlbXMpIHx8IGJsb2NrLml0ZW1zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IGxpc3RUeXBlID0gYmxvY2sub3JkZXJlZCA/ICdvcmRlcmVkJyA6ICd1bm9yZGVyZWQnO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBibG9jay5pdGVtcy5tYXAoKGl0ZW0sIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgIGlmIChsaXN0VHlwZSA9PT0gJ29yZGVyZWQnKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYCR7aW5kZXggKyAxfS4gJHtpdGVtLnRleHQgfHwgJyd9YDtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBgLSAke2l0ZW0udGV4dCB8fCAnJ31gO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSkuam9pbignXFxuJyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyB0YWJsZSBibG9ja1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gVGFibGUgYmxvY2tcclxuICAgICAqIEByZXR1cm5zIHtzdHJpbmd9IE1hcmtkb3duIHRhYmxlXHJcbiAgICAgKi9cclxuICAgIHByb2Nlc3NUYWJsZShibG9jaykge1xyXG4gICAgICAgIGlmICghYmxvY2sucm93cyB8fCAhQXJyYXkuaXNBcnJheShibG9jay5yb3dzKSB8fCBibG9jay5yb3dzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IHRhYmxlUm93cyA9IGJsb2NrLnJvd3MubWFwKHJvdyA9PiB7XHJcbiAgICAgICAgICAgIGlmICghcm93LmNlbGxzIHx8ICFBcnJheS5pc0FycmF5KHJvdy5jZWxscykpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiAnfCB8JztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgY2VsbHMgPSByb3cuY2VsbHMubWFwKGNlbGwgPT4gY2VsbC50ZXh0IHx8ICcnKS5qb2luKCcgfCAnKTtcclxuICAgICAgICAgICAgcmV0dXJuIGB8ICR7Y2VsbHN9IHxgO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEluc2VydCBoZWFkZXIgc2VwYXJhdG9yIGFmdGVyIHRoZSBmaXJzdCByb3dcclxuICAgICAgICBpZiAodGFibGVSb3dzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAgICAgY29uc3QgaGVhZGVyUm93ID0gdGFibGVSb3dzWzBdO1xyXG4gICAgICAgICAgICBjb25zdCBzZXBhcmF0b3JDb3VudCA9IChoZWFkZXJSb3cubWF0Y2goL1xcfC9nKSB8fCBbXSkubGVuZ3RoIC0gMTtcclxuICAgICAgICAgICAgY29uc3Qgc2VwYXJhdG9yID0gYHwkeycgLS0tIHwnLnJlcGVhdChzZXBhcmF0b3JDb3VudCl9YDtcclxuICAgICAgICAgICAgdGFibGVSb3dzLnNwbGljZSgxLCAwLCBzZXBhcmF0b3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gdGFibGVSb3dzLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgaW1hZ2UgYmxvY2tcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBibG9jayAtIEltYWdlIGJsb2NrXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBpbWFnZSByZWZlcmVuY2VcclxuICAgICAqL1xyXG4gICAgcHJvY2Vzc0ltYWdlKGJsb2NrKSB7XHJcbiAgICAgICAgY29uc3QgY2FwdGlvbiA9IGJsb2NrLmNhcHRpb24gfHwgYmxvY2suYWx0IHx8ICdJbWFnZSc7XHJcbiAgICAgICAgY29uc3Qgc291cmNlID0gYmxvY2suc3JjIHx8IGJsb2NrLnNvdXJjZSB8fCBibG9jay51cmwgfHwgJ2ltYWdlLXJlZmVyZW5jZSc7XHJcbiAgICAgICAgcmV0dXJuIGAhWyR7Y2FwdGlvbn1dKCR7c291cmNlfSlgO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgY29kZSBibG9ja1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGJsb2NrIC0gQ29kZSBibG9ja1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29kZSBibG9ja1xyXG4gICAgICovXHJcbiAgICBwcm9jZXNzQ29kZUJsb2NrKGJsb2NrKSB7XHJcbiAgICAgICAgY29uc3QgbGFuZ3VhZ2UgPSBibG9jay5sYW5ndWFnZSB8fCAnJztcclxuICAgICAgICBjb25zdCBjb2RlID0gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8IGJsb2NrLmNvZGUgfHwgJyc7XHJcbiAgICAgICAgcmV0dXJuIGBcXGBcXGBcXGAke2xhbmd1YWdlfVxcbiR7Y29kZX1cXG5cXGBcXGBcXGBgO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgcXVvdGUgYmxvY2tcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBibG9jayAtIFF1b3RlIGJsb2NrXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBxdW90ZVxyXG4gICAgICovXHJcbiAgICBwcm9jZXNzUXVvdGUoYmxvY2spIHtcclxuICAgICAgICBjb25zdCB0ZXh0ID0gYmxvY2sudGV4dCB8fCBibG9jay5jb250ZW50IHx8ICcnO1xyXG4gICAgICAgIC8vIFNwbGl0IGJ5IG5ld2xpbmVzIGFuZCBhZGQgPiB0byBlYWNoIGxpbmVcclxuICAgICAgICByZXR1cm4gdGV4dC5zcGxpdCgnXFxuJykubWFwKGxpbmUgPT4gYD4gJHtsaW5lfWApLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBQREYgbWV0YWRhdGEgYW5kIE9DUiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBQREYgbWV0YWRhdGEgYW5kIE9DUiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFBERiBtZXRhZGF0YVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9jclJlc3VsdCAtIE9DUiByZXN1bHRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucykge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbFBkZkNvbnZlcnRlcl0gR2VuZXJhdGluZyBtYXJrZG93biBmcm9tIE9DUiByZXN1bHQnKTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBTdGFydCB3aXRoIGhlYWRlclxyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bkhlYWRlcihtZXRhZGF0YSwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgT0NSIGluZm9ybWF0aW9uXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJyMjIE9DUiBJbmZvcm1hdGlvbicpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnVGhpcyBkb2N1bWVudCB3YXMgcHJvY2Vzc2VkIHVzaW5nIE1pc3RyYWwgT0NSIHRlY2hub2xvZ3kuJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgT0NSIG1vZGVsIGFuZCBsYW5ndWFnZSBpbmZvcm1hdGlvbiBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQuZG9jdW1lbnRJbmZvKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBkb2NJbmZvID0gb2NyUmVzdWx0LmRvY3VtZW50SW5mbztcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGRvY0luZm8ubW9kZWwgJiYgZG9jSW5mby5tb2RlbCAhPT0gJ3Vua25vd24nKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBNb2RlbCB8ICR7ZG9jSW5mby5tb2RlbH0gfGApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoZG9jSW5mby5sYW5ndWFnZSAmJiBkb2NJbmZvLmxhbmd1YWdlICE9PSAndW5rbm93bicpIHtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGB8IExhbmd1YWdlIHwgJHtkb2NJbmZvLmxhbmd1YWdlfSB8YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChkb2NJbmZvLnByb2Nlc3NpbmdUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQcm9jZXNzaW5nIFRpbWUgfCAke2RvY0luZm8ucHJvY2Vzc2luZ1RpbWV9cyB8YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChkb2NJbmZvLm92ZXJhbGxDb25maWRlbmNlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgY29uZmlkZW5jZVBlcmNlbnQgPSBNYXRoLnJvdW5kKGRvY0luZm8ub3ZlcmFsbENvbmZpZGVuY2UgKiAxMDApO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYHwgT3ZlcmFsbCBDb25maWRlbmNlIHwgJHtjb25maWRlbmNlUGVyY2VudH0lIHxgKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHVzYWdlIGluZm9ybWF0aW9uIGlmIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICAgICAgaWYgKGRvY0luZm8udXNhZ2UpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAoZG9jSW5mby51c2FnZS50b3RhbF90b2tlbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBUb3RhbCBUb2tlbnMgfCAke2RvY0luZm8udXNhZ2UudG90YWxfdG9rZW5zfSB8YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIGlmIChkb2NJbmZvLnVzYWdlLnByb21wdF90b2tlbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQcm9tcHQgVG9rZW5zIHwgJHtkb2NJbmZvLnVzYWdlLnByb21wdF90b2tlbnN9IHxgKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGRvY0luZm8udXNhZ2UuY29tcGxldGlvbl90b2tlbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBDb21wbGV0aW9uIFRva2VucyB8ICR7ZG9jSW5mby51c2FnZS5jb21wbGV0aW9uX3Rva2Vuc30gfGApO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIGVycm9yIGluZm9ybWF0aW9uIGlmIHByZXNlbnRcclxuICAgICAgICAgICAgICAgIGlmIChkb2NJbmZvLmVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgfCBFcnJvciB8ICR7ZG9jSW5mby5lcnJvcn0gfGApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBjb250ZW50IGZvciBlYWNoIHBhZ2VcclxuICAgICAgICAgICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQucGFnZXMgJiYgb2NyUmVzdWx0LnBhZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgIG9jclJlc3VsdC5wYWdlcy5mb3JFYWNoKChwYWdlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFVzZSBwYWdlIG51bWJlciBpZiBhdmFpbGFibGUsIG90aGVyd2lzZSB1c2UgaW5kZXggKyAxXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFnZU51bWJlciA9IHBhZ2UucGFnZU51bWJlciB8fCBpbmRleCArIDE7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke3BhZ2VOdW1iZXJ9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQWRkIHBhZ2UgY29uZmlkZW5jZSBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGFnZS5jb25maWRlbmNlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGNvbmZpZGVuY2VQZXJjZW50ID0gTWF0aC5yb3VuZChwYWdlLmNvbmZpZGVuY2UgKiAxMDApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGA+IE9DUiBDb25maWRlbmNlOiAke2NvbmZpZGVuY2VQZXJjZW50fSVgKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEFkZCBwYWdlIGRpbWVuc2lvbnMgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhZ2Uud2lkdGggJiYgcGFnZS5oZWlnaHQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPiBEaW1lbnNpb25zOiAke3BhZ2Uud2lkdGh9IMOXICR7cGFnZS5oZWlnaHR9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBBZGQgcGFnZSB0ZXh0IHdpdGggYmV0dGVyIGhhbmRsaW5nIG9mIGRpZmZlcmVudCBjb250ZW50IGZvcm1hdHNcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcGFnZUNvbnRlbnQgPSAnJztcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBpZiAocGFnZS50ZXh0ICYmIHBhZ2UudGV4dC50cmltKCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZUNvbnRlbnQgPSBwYWdlLnRleHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIGlmIChwYWdlLmNvbnRlbnQgJiYgdHlwZW9mIHBhZ2UuY29udGVudCA9PT0gJ3N0cmluZycgJiYgcGFnZS5jb250ZW50LnRyaW0oKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBwYWdlQ29udGVudCA9IHBhZ2UuY29udGVudDtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKHBhZ2UuYmxvY2tzICYmIEFycmF5LmlzQXJyYXkocGFnZS5ibG9ja3MpICYmIHBhZ2UuYmxvY2tzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gSWYgd2UgaGF2ZSBibG9ja3MgYnV0IHRleHQgd2Fzbid0IHByb2Nlc3NlZCBlYXJsaWVyLCBwcm9jZXNzIHRoZW0gbm93XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHRleHRCbG9ja3MgPSB0aGlzLnByb2Nlc3NDb250ZW50QmxvY2tzKHBhZ2UuYmxvY2tzKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZUNvbnRlbnQgPSB0ZXh0QmxvY2tzLmpvaW4oJ1xcblxcbicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAocGFnZS5lbGVtZW50cyAmJiBBcnJheS5pc0FycmF5KHBhZ2UuZWxlbWVudHMpICYmIHBhZ2UuZWxlbWVudHMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBJZiB3ZSBoYXZlIGVsZW1lbnRzIGJ1dCB0ZXh0IHdhc24ndCBwcm9jZXNzZWQgZWFybGllciwgcHJvY2VzcyB0aGVtIG5vd1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBlbGVtZW50cyA9IHBhZ2UuZWxlbWVudHMubWFwKGVsZW1lbnQgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnICYmIGVsZW1lbnQudGV4dCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LnRleHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKGVsZW1lbnQuY29udGVudCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50LmNvbnRlbnQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gJyc7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pLmZpbHRlcih0ZXh0ID0+IHRleHQudHJpbSgpLmxlbmd0aCA+IDApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGFnZUNvbnRlbnQgPSBlbGVtZW50cy5qb2luKCdcXG5cXG4nKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHBhZ2VDb250ZW50ICYmIHBhZ2VDb250ZW50LnRyaW0oKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKHBhZ2VDb250ZW50KTtcclxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcqTm8gdGV4dCBjb250ZW50IHdhcyBleHRyYWN0ZWQgZnJvbSB0aGlzIHBhZ2UuKicpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnTm8gdGV4dCBjb250ZW50IHdhcyBleHRyYWN0ZWQgZnJvbSB0aGlzIGRvY3VtZW50LicpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgcmF3IHRleHQgZmllbGQgYXQgdGhlIGRvY3VtZW50IGxldmVsLCB1c2UgdGhhdFxyXG4gICAgICAgICAgICAgICAgaWYgKG9jclJlc3VsdCAmJiBvY3JSZXN1bHQudGV4dCAmJiB0eXBlb2Ygb2NyUmVzdWx0LnRleHQgPT09ICdzdHJpbmcnICYmIG9jclJlc3VsdC50ZXh0LnRyaW0oKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJyMjIERvY3VtZW50IENvbnRlbnQnKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKG9jclJlc3VsdC50ZXh0KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAob2NyUmVzdWx0ICYmIG9jclJlc3VsdC5jb250ZW50ICYmIHR5cGVvZiBvY3JSZXN1bHQuY29udGVudCA9PT0gJ3N0cmluZycgJiYgb2NyUmVzdWx0LmNvbnRlbnQudHJpbSgpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgRG9jdW1lbnQgQ29udGVudCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2gob2NyUmVzdWx0LmNvbnRlbnQpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE1hcmtkb3duIGdlbmVyYXRpb24gY29tcGxldGUnKTtcclxuICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBFcnJvciBnZW5lcmF0aW5nIG1hcmtkb3duOicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIGZhbGxiYWNrIG1hcmtkb3duIHdpdGggZXJyb3IgaW5mb3JtYXRpb25cclxuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tNYXJrZG93biA9IFtcclxuICAgICAgICAgICAgICAgICcjIE9DUiBDb252ZXJzaW9uIFJlc3VsdCcsXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgICcjIyBFcnJvciBJbmZvcm1hdGlvbicsXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgIGBBbiBlcnJvciBvY2N1cnJlZCBkdXJpbmcgbWFya2Rvd24gZ2VuZXJhdGlvbjogJHtlcnJvci5tZXNzYWdlfWAsXHJcbiAgICAgICAgICAgICAgICAnJyxcclxuICAgICAgICAgICAgICAgICcjIyBEb2N1bWVudCBJbmZvcm1hdGlvbicsXHJcbiAgICAgICAgICAgICAgICAnJ1xyXG4gICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGFueSBtZXRhZGF0YSB3ZSBoYXZlXHJcbiAgICAgICAgICAgIGlmIChtZXRhZGF0YSkge1xyXG4gICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcjIyMgTWV0YWRhdGEnKTtcclxuICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGlmIChtZXRhZGF0YS50aXRsZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipUaXRsZToqKiAke21ldGFkYXRhLnRpdGxlfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKG1ldGFkYXRhLmF1dGhvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipBdXRob3I6KiogJHttZXRhZGF0YS5hdXRob3J9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAobWV0YWRhdGEuc3ViamVjdCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipTdWJqZWN0OioqICR7bWV0YWRhdGEuc3ViamVjdH1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChtZXRhZGF0YS5rZXl3b3Jkcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChgKipLZXl3b3JkczoqKiAke21ldGFkYXRhLmtleXdvcmRzfWApO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgaWYgKG1ldGFkYXRhLmNyZWF0b3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqQ3JlYXRvcjoqKiAke21ldGFkYXRhLmNyZWF0b3J9YCk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAobWV0YWRhdGEucHJvZHVjZXIpIHtcclxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqUHJvZHVjZXI6KiogJHttZXRhZGF0YS5wcm9kdWNlcn1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChtZXRhZGF0YS5jcmVhdGlvbkRhdGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCoqQ3JlYXRpb24gRGF0ZToqKiAke21ldGFkYXRhLmNyZWF0aW9uRGF0ZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChtZXRhZGF0YS5tb2RpZmljYXRpb25EYXRlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKGAqKk1vZGlmaWNhdGlvbiBEYXRlOioqICR7bWV0YWRhdGEubW9kaWZpY2F0aW9uRGF0ZX1gKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGFueSByYXcgT0NSIHJlc3VsdCB0ZXh0IGlmIGF2YWlsYWJsZVxyXG4gICAgICAgICAgICBpZiAob2NyUmVzdWx0KSB7XHJcbiAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJyMjIyBPQ1IgUmVzdWx0Jyk7XHJcbiAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAob2NyUmVzdWx0LnRleHQpIHtcclxuICAgICAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2gob2NyUmVzdWx0LnRleHQpO1xyXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChvY3JSZXN1bHQuY29udGVudCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZhbGxiYWNrTWFya2Rvd24ucHVzaChvY3JSZXN1bHQuY29udGVudCk7XHJcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG9jclJlc3VsdC5wYWdlcyAmJiBvY3JSZXN1bHQucGFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG9jclJlc3VsdC5wYWdlcy5mb3JFYWNoKChwYWdlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBmYWxsYmFja01hcmtkb3duLnB1c2goYCMjIyMgUGFnZSAke2luZGV4ICsgMX1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKHBhZ2UudGV4dCB8fCBwYWdlLmNvbnRlbnQgfHwgJypObyBjb250ZW50IGF2YWlsYWJsZSonKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZmFsbGJhY2tNYXJrZG93bi5wdXNoKCcqTm8gT0NSIGNvbnRlbnQgYXZhaWxhYmxlKicpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gZmFsbGJhY2tNYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDb252ZXJ0IFBERiBjb250ZW50IHRvIG1hcmtkb3duIC0gZGlyZWN0IG1ldGhvZCBmb3IgQ29udmVydGVyUmVnaXN0cnlcclxuICAgICAqIEBwYXJhbSB7QnVmZmVyfSBjb250ZW50IC0gUERGIGNvbnRlbnQgYXMgYnVmZmVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEZpbGUgbmFtZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGFwaUtleSAtIEFQSSBrZXkgZm9yIE1pc3RyYWxcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBDb252ZXJzaW9uIHJlc3VsdFxyXG4gICAgICovXHJcbiAgICBhc3luYyBjb252ZXJ0VG9NYXJrZG93bihjb250ZW50LCBvcHRpb25zID0ge30pIHtcclxuICAgICAgICBsZXQgdGVtcERpciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtNaXN0cmFsUGRmQ29udmVydGVyXSBDb252ZXJ0aW5nIFBERiB3aXRoIE9DUjogJHtvcHRpb25zLm5hbWUgfHwgJ3VubmFtZWQnfWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2hlY2sgaWYgQVBJIGtleSBpcyBhdmFpbGFibGUgZnJvbSBtdWx0aXBsZSBzb3VyY2VzXHJcbiAgICAgICAgICAgIGlmICghdGhpcy5hcGlLZXkgJiYgIW9wdGlvbnMuYXBpS2V5ICYmICFwcm9jZXNzLmVudi5NSVNUUkFMX0FQSV9LRVkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTWlzdHJhbCBBUEkga2V5IG5vdCBjb25maWd1cmVkJyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFVzZSB0aGUgQVBJIGtleSBmcm9tIG9wdGlvbnMgaWYgcHJvdmlkZWQsIHRoZW4gZnJvbSBpbnN0YW5jZSwgdGhlbiBmcm9tIGVudlxyXG4gICAgICAgICAgICBjb25zdCBhcGlLZXkgPSBvcHRpb25zLmFwaUtleSB8fCB0aGlzLmFwaUtleSB8fCBwcm9jZXNzLmVudi5NSVNUUkFMX0FQSV9LRVk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBUZW1wb3JhcmlseSBzZXQgdGhlIEFQSSBrZXkgZm9yIHRoaXMgb3BlcmF0aW9uXHJcbiAgICAgICAgICAgIGNvbnN0IG9yaWdpbmFsQXBpS2V5ID0gdGhpcy5hcGlLZXk7XHJcbiAgICAgICAgICAgIHRoaXMuYXBpS2V5ID0gYXBpS2V5O1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBVc2luZyBBUEkga2V5IGZvciBPQ1IgY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGZpbGUgdG8gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0ZW1wRGlyID0gYXdhaXQgZnMubWtkdGVtcChwYXRoLmpvaW4ocmVxdWlyZSgnb3MnKS50bXBkaXIoKSwgJ3BkZi1vY3ItY29udmVyc2lvbi0nKSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBGaWxlID0gcGF0aC5qb2luKHRlbXBEaXIsIGAke29wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQnfS5wZGZgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFdyaXRlIGJ1ZmZlciB0byB0ZW1wIGZpbGVcclxuICAgICAgICAgICAgYXdhaXQgZnMud3JpdGVGaWxlKHRlbXBGaWxlLCBjb250ZW50KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgbWV0YWRhdGEgdXNpbmcgc3RhbmRhcmQgbWV0aG9kc1xyXG4gICAgICAgICAgICBjb25zdCBTdGFuZGFyZFBkZkNvbnZlcnRlciA9IHJlcXVpcmUoJy4vU3RhbmRhcmRQZGZDb252ZXJ0ZXInKTtcclxuICAgICAgICAgICAgY29uc3Qgc3RhbmRhcmRDb252ZXJ0ZXIgPSBuZXcgU3RhbmRhcmRQZGZDb252ZXJ0ZXIoKTtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCBzdGFuZGFyZENvbnZlcnRlci5leHRyYWN0TWV0YWRhdGEodGVtcEZpbGUpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTG9nIG1ldGFkYXRhIGZvciBkZWJ1Z2dpbmdcclxuICAgICAgICAgICAgY29uc29sZS5sb2coJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBFeHRyYWN0ZWQgbWV0YWRhdGE6Jywge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6IG1ldGFkYXRhLnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgYXV0aG9yOiBtZXRhZGF0YS5hdXRob3IsXHJcbiAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IG1ldGFkYXRhLnBhZ2VDb3VudFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFjdHVhbGx5IHByb2Nlc3Mgd2l0aCBPQ1IgdXNpbmcgdGhlIGV4aXN0aW5nIG1ldGhvZFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgUERGIHdpdGggT0NSJyk7XHJcbiAgICAgICAgICAgIGNvbnN0IG9jclJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc1dpdGhPY3IodGVtcEZpbGUsIHtcclxuICAgICAgICAgICAgICAgIC4uLm9wdGlvbnMsXHJcbiAgICAgICAgICAgICAgICAvLyBVc2UgdGhlIGNvcnJlY3QgbW9kZWwgbmFtZSBmcm9tIE1pc3RyYWwgQVBJIGRvY3VtZW50YXRpb25cclxuICAgICAgICAgICAgICAgIG1vZGVsOiBcIm1pc3RyYWwtb2NyLWxhdGVzdFwiLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6IG9wdGlvbnMubGFuZ3VhZ2VcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBMb2cgT0NSIHJlc3VsdCBzdHJ1Y3R1cmUgZm9yIGRlYnVnZ2luZ1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE9DUiByZXN1bHQgc3RydWN0dXJlOicsXHJcbiAgICAgICAgICAgICAgICBvY3JSZXN1bHQgPyBPYmplY3Qua2V5cyhvY3JSZXN1bHQpLmpvaW4oJywgJykgOiAnbnVsbCcpO1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxQZGZDb252ZXJ0ZXJdIE9DUiBwYWdlcyBjb3VudDonLFxyXG4gICAgICAgICAgICAgICAgb2NyUmVzdWx0ICYmIG9jclJlc3VsdC5wYWdlcyA/IG9jclJlc3VsdC5wYWdlcy5sZW5ndGggOiAwKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICAgICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnRlZERhdGUgPSBub3cudG9JU09TdHJpbmcoKS5zcGxpdCgnLicpWzBdLnJlcGxhY2UoJ1QnLCAnICcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIGZpbGVuYW1lXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVUaXRsZSA9IG1ldGFkYXRhLnRpdGxlIHx8IG9wdGlvbnMubmFtZSB8fCAnUERGIERvY3VtZW50JztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBbXHJcbiAgICAgICAgICAgICAgICAnLS0tJyxcclxuICAgICAgICAgICAgICAgIGB0aXRsZTogJHtmaWxlVGl0bGV9YCxcclxuICAgICAgICAgICAgICAgIGBjb252ZXJ0ZWQ6ICR7Y29udmVydGVkRGF0ZX1gLFxyXG4gICAgICAgICAgICAgICAgJ3R5cGU6IHBkZi1vY3InLFxyXG4gICAgICAgICAgICAgICAgJy0tLScsXHJcbiAgICAgICAgICAgICAgICAnJ1xyXG4gICAgICAgICAgICBdLmpvaW4oJ1xcbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBPQ1IgcmVzdWx0c1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93bkNvbnRlbnQgPSB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIG9jclJlc3VsdCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDb21iaW5lIGZyb250bWF0dGVyIGFuZCBjb250ZW50XHJcbiAgICAgICAgICAgIGNvbnN0IGZpbmFsTWFya2Rvd24gPSBmcm9udG1hdHRlciArIG1hcmtkb3duQ29udGVudDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSByZXN1bHQgb2JqZWN0IHdpdGggZW5oYW5jZWQgaW5mb3JtYXRpb25cclxuICAgICAgICAgICAgY29uc3QgcmVzdWx0ID0ge1xyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgICAgICAgICAgIGNvbnRlbnQ6IGZpbmFsTWFya2Rvd24sXHJcbiAgICAgICAgICAgICAgICB0eXBlOiAncGRmJyxcclxuICAgICAgICAgICAgICAgIG5hbWU6IG9wdGlvbnMubmFtZSB8fCAnZG9jdW1lbnQucGRmJyxcclxuICAgICAgICAgICAgICAgIG1ldGFkYXRhOiBtZXRhZGF0YSxcclxuICAgICAgICAgICAgICAgIG9jckluZm86IHtcclxuICAgICAgICAgICAgICAgICAgICBtb2RlbDogb2NyUmVzdWx0Py5kb2N1bWVudEluZm8/Lm1vZGVsIHx8ICd1bmtub3duJyxcclxuICAgICAgICAgICAgICAgICAgICBsYW5ndWFnZTogb2NyUmVzdWx0Py5kb2N1bWVudEluZm8/Lmxhbmd1YWdlIHx8ICd1bmtub3duJyxcclxuICAgICAgICAgICAgICAgICAgICBwYWdlQ291bnQ6IG9jclJlc3VsdD8ucGFnZXM/Lmxlbmd0aCB8fCAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbmZpZGVuY2U6IG9jclJlc3VsdD8uZG9jdW1lbnRJbmZvPy5vdmVyYWxsQ29uZmlkZW5jZSB8fCAwXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZXN0b3JlIG9yaWdpbmFsIEFQSSBrZXlcclxuICAgICAgICAgICAgdGhpcy5hcGlLZXkgPSBvcmlnaW5hbEFwaUtleTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgIGlmICh0ZW1wRGlyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcilcclxuICAgICAgICAgICAgICAgICAgICAuY2F0Y2goZXJyID0+IGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBFcnJvciBjbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTonLCBlcnIpKTtcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIgPSBudWxsO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gcmVzdWx0O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBEaXJlY3QgY29udmVyc2lvbiBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnkgaWYgaXQgZXhpc3RzXHJcbiAgICAgICAgICAgIGlmICh0ZW1wRGlyKSB7XHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGNsZWFudXBFcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsUGRmQ29udmVydGVyXSBFcnJvciBjbGVhbmluZyB1cCB0ZW1wIGRpcmVjdG9yeTonLCBjbGVhbnVwRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBtb3JlIGRldGFpbGVkIGVycm9yIG1lc3NhZ2VcclxuICAgICAgICAgICAgY29uc3QgZXJyb3JEZXRhaWxzID0gZXJyb3IucmVzcG9uc2UgP1xyXG4gICAgICAgICAgICAgICAgYEFQSSByZXNwb25zZTogJHtKU09OLnN0cmluZ2lmeShlcnJvci5yZXNwb25zZS5kYXRhIHx8IHt9KX1gIDpcclxuICAgICAgICAgICAgICAgIGVycm9yLm1lc3NhZ2U7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIGlzIGEgNTAwIEludGVybmFsIFNlcnZlciBFcnJvclxyXG4gICAgICAgICAgICBsZXQgZXJyb3JNZXNzYWdlID0gZXJyb3IubWVzc2FnZTtcclxuICAgICAgICAgICAgbGV0IHRyb3VibGVzaG9vdGluZ0luZm8gPSAnJztcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCc1MDAnKSB8fCBlcnJvci5tZXNzYWdlLmluY2x1ZGVzKCdJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InKSkge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxQZGZDb252ZXJ0ZXJdIERldGVjdGVkIDUwMCBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3InKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIHRyb3VibGVzaG9vdGluZyBpbmZvcm1hdGlvbiBmb3IgNTAwIGVycm9yc1xyXG4gICAgICAgICAgICAgICAgdHJvdWJsZXNob290aW5nSW5mbyA9IGBcclxuIyMgVHJvdWJsZXNob290aW5nIDUwMCBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcclxuXHJcblRoaXMgZXJyb3IgbWF5IGJlIGNhdXNlZCBieTpcclxuXHJcbjEuICoqRmlsZSBTaXplIExpbWl0Kio6IFRoZSBQREYgZmlsZSBtYXkgZXhjZWVkIE1pc3RyYWwncyA1ME1CIHNpemUgbGltaXQuXHJcbjIuICoqQVBJIFNlcnZpY2UgSXNzdWVzKio6IE1pc3RyYWwncyBBUEkgbWF5IGJlIGV4cGVyaWVuY2luZyB0ZW1wb3JhcnkgaXNzdWVzLlxyXG4zLiAqKlJhdGUgTGltaXRpbmcqKjogWW91IG1heSBoYXZlIGV4Y2VlZGVkIHRoZSBBUEkgcmF0ZSBsaW1pdHMuXHJcbjQuICoqTWFsZm9ybWVkIFJlcXVlc3QqKjogVGhlIHJlcXVlc3QgZm9ybWF0IG1heSBub3QgbWF0Y2ggTWlzdHJhbCdzIEFQSSByZXF1aXJlbWVudHMuXHJcblxyXG4jIyMgU3VnZ2VzdGVkIEFjdGlvbnM6XHJcbi0gVHJ5IHdpdGggYSBzbWFsbGVyIFBERiBmaWxlXHJcbi0gQ2hlY2sgaWYgeW91ciBNaXN0cmFsIEFQSSBrZXkgaGFzIHN1ZmZpY2llbnQgcGVybWlzc2lvbnNcclxuLSBUcnkgYWdhaW4gbGF0ZXIgaWYgaXQncyBhIHRlbXBvcmFyeSBzZXJ2aWNlIGlzc3VlXHJcbi0gVmVyaWZ5IHlvdXIgQVBJIHN1YnNjcmlwdGlvbiBzdGF0dXNcclxuYDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgZXJyb3I6IGBQREYgT0NSIGNvbnZlcnNpb24gZmFpbGVkOiAke2Vycm9yTWVzc2FnZX1gLFxyXG4gICAgICAgICAgICAgICAgZXJyb3JEZXRhaWxzOiBlcnJvckRldGFpbHMsXHJcbiAgICAgICAgICAgICAgICBjb250ZW50OiBgIyBDb252ZXJzaW9uIEVycm9yXFxuXFxuRmFpbGVkIHRvIGNvbnZlcnQgUERGIHdpdGggT0NSOiAke2Vycm9yTWVzc2FnZX1cXG5cXG4jIyBFcnJvciBEZXRhaWxzXFxuXFxuJHtlcnJvckRldGFpbHN9XFxuXFxuJHt0cm91Ymxlc2hvb3RpbmdJbmZvfWBcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6IHRoaXMubmFtZSxcclxuICAgICAgICAgICAgZXh0ZW5zaW9uczogdGhpcy5zdXBwb3J0ZWRFeHRlbnNpb25zLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBkb2N1bWVudCB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBtb2RlbDogJ09DUiBtb2RlbCB0byB1c2UgKGRlZmF1bHQ6IG1pc3RyYWwtb2NyLWxhdGVzdCknLFxyXG4gICAgICAgICAgICAgICAgbGFuZ3VhZ2U6ICdMYW5ndWFnZSBoaW50IGZvciBPQ1IgKG9wdGlvbmFsKScsXHJcbiAgICAgICAgICAgICAgICBtYXhQYWdlczogJ01heGltdW0gcGFnZXMgdG8gY29udmVydCAoZGVmYXVsdDogYWxsKSdcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTWlzdHJhbFBkZkNvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOzs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxRQUFRLEdBQUdG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