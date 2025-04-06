// services/converter/pdf/StandardPdfConverter.js

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import crypto from 'crypto';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import pdfParse from 'pdf-parse';
import BasePdfConverter from './BasePdfConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Standard PDF converter implementation using pdf-parse
 * Provides basic PDF text extraction without external dependencies
 * 
 * This converter uses a pure JavaScript approach to extract text from PDFs,
 * eliminating the need for external dependencies like Poppler.
 * 
 * For image extraction and more advanced OCR capabilities, use MistralPdfConverter.
 * 
 * Related files:
 * - BasePdfConverter.js: Parent abstract class
 * - MistralPdfConverter.js: Alternative implementation using OCR
 */
export class StandardPdfConverter extends BasePdfConverter {
  /**
   * Configuration for the converter
   */
  config = {
    name: 'Standard PDF Converter',
    version: '1.0.0',
    supportedExtensions: ['.pdf'],
    supportedMimeTypes: ['application/pdf'],
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
    requiresPoppler: false, // No external dependencies
    options: {
      // pdf-parse options
      pagerender: null, // use default pagerender
      max: 0, // no limit on pages
      minImageSize: 5120, // 5KB - kept for compatibility
    }
  };

  /**
   * Checks if a file exists
   * @private
   */
  async fileExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fallback image extraction using pdf-lib
   * @private
   */
  async extractImagesWithFallback(pdfBuffer, originalName) {
    let pdfDoc;
    const images = [];
    const imageHashes = new Map();

    try {
      const { PDFDocument } = await import('pdf-lib');
      console.log('📚 Loading PDF document for image extraction');
      pdfDoc = await PDFDocument.load(pdfBuffer);
      
      console.log('📄 Processing PDF pages:', {
        pageCount: pdfDoc.getPageCount(),
        fileSize: pdfBuffer.length
      });

      for (let i = 0; i < pdfDoc.getPageCount(); i++) {
        const page = pdfDoc.getPage(i);
        
        // Get page resources
        if (!page || !page.node) continue;
        
        const resources = page.node.Resources;
        if (!resources) continue;
        
        const xObjects = resources.lookup('XObject');
        if (!xObjects) continue;

        // Get all XObject names
        const xObjectKeys = xObjects.keys();

        for (const key of xObjectKeys) {
          const xObject = xObjects.lookup(key);
          
          // Check if it's an image
          if (!xObject || xObject.Subtype?.name !== 'Image') continue;

          try {
            const imageData = await xObject.getContents();
            if (!imageData || imageData.length < this.config.options.minImageSize) continue;

            const hash = crypto.createHash('sha256').update(imageData).digest('hex');
            if (imageHashes.has(hash)) continue;
            
            imageHashes.set(hash, true);

            // Determine format based on filter
            const filter = xObject.Filter?.name;
            const format = filter === 'DCTDecode' ? 'jpeg' : 'png';

            const baseName = path.basename(originalName, '.pdf');
            const generatedPath = this.generateUniqueImageName(baseName, i, format);

            const imageObject = {
              name: generatedPath,
              data: imageData.toString('base64'),
              type: `image/${format}`,
              path: generatedPath,
              hash: hash,
              size: imageData.length,
              pageIndex: i
            };

            if (this.validateImageObject(imageObject)) {
              images.push(imageObject);
              console.log(`📸 Added image from page ${i}: ${imageObject.name} (${imageData.length} bytes, data: ${this.truncateBase64(imageObject.data)})`);
            } else {
              console.warn(`⚠️ Invalid image object structure for ${imageObject.name} on page ${i}`);
            }
          } catch (imageError) {
            console.warn(`Failed to extract image from page ${i}:`, imageError);
            continue;
          }
        }
      }

      return images;
    } catch (error) {
      console.error('Image extraction failed:', error);
      return [];
    }
  }

  /**
   * Extract images from PDF
   * @override
   */
  async extractImages(pdfBuffer, originalName) {
    console.log('📸 Image extraction skipped in standard converter');
    console.log('📸 For image extraction, use the OCR converter with a Mistral API key');
    
    // Return empty array as this converter doesn't extract images by default
    // Users who need images should use the Mistral OCR converter
    return [];
    
    // Uncomment the following line to enable basic image extraction using pdf-lib
    // return await this.extractImagesWithFallback(pdfBuffer, originalName);
  }

  /**
   * Extract text from PDF using pdf-parse
   * @override
   */
  async extractText(pdfBuffer, preservePageInfo = false) {
    try {
      console.log('📄 Extracting text using pdf-parse');
      
      // Parse PDF
      const data = await pdfParse(pdfBuffer, this.config.options);
      
      // Get page count
      const numPages = data.numpages || 0;
      console.log(`📄 PDF has ${numPages} pages`);
      
      let pageBreaks = [];
      
      // If preservePageInfo is true, we can try to estimate page breaks
      // This is not as accurate as Poppler's extraction but provides a basic approximation
      if (preservePageInfo && numPages > 1) {
        // pdf-parse doesn't provide page break information directly
        // We can approximate by dividing the text evenly across pages
        const textLength = data.text.length;
        const avgPageLength = Math.floor(textLength / numPages);
        
        for (let i = 1; i < numPages; i++) {
          pageBreaks.push({
            pageNumber: i + 1,
            position: i * avgPageLength
          });
        }
        
        console.log(`📄 Estimated ${pageBreaks.length} page breaks`);
      }
      
      return {
        text: data.text,
        pageBreaks,
        pageCount: numPages
      };
    } catch (error) {
      console.error('Text extraction error:', error);
      return {
        text: '',
        pageBreaks: [],
        pageCount: 0
      };
    }
  }

  /**
   * Main converter function that transforms PDF to Markdown
   * @override
   */
  async convertPdfToMarkdown(input, originalName, apiKey, options = {}) {
    try {
      // Validate input
      this.validatePdfInput(input);

      // Extract text using pdf-parse
      const { text: textContent, pageBreaks, pageCount } = await this.extractText(input, options.preservePageInfo);
      
      // Extract images (will be empty in this implementation)
      const images = await this.extractImages(input, originalName);
      
      const baseName = path.basename(originalName, '.pdf');
      
      // Create metadata object
      const metadata = this.createMetadata(baseName, images.length, pageCount);

      // Process text content
      const processedText = textContent
        .replace(/(\r\n|\r|\n){3,}/g, '\n\n')
        .replace(/[^\S\r\n]+/g, ' ')
        .trim();

      // Add image references using Obsidian format if any images were extracted
      let imageSection = '';
      if (images.length > 0) {
        imageSection = '\n\n## Extracted Images\n\n' +
          images.map(img => this.generateImageMarkdown(img.path)).join('\n\n');
      } else {
        // Add a note about OCR for image extraction
        imageSection = '\n\n> Note: This conversion includes text only. For image extraction, enable OCR conversion with a Mistral API key in settings.';
      }

      // Generate content without frontmatter
      const content = [
        `# PDF: ${baseName}`,
        '',
        processedText,
        imageSection
      ].join('\n');

      return {
        success: true,
        content: content,
        metadata: {
          ...metadata,
          mimeType: 'application/pdf',
          created: new Date().toISOString()
        },
        type: 'pdf',
        name: originalName,
        category: 'documents',
        originalContent: input,
        images: images,
        pageBreaks: options.preservePageInfo ? pageBreaks : undefined,
        stats: {
          inputSize: input.length,
          outputSize: content.length,
          imageCount: images.length,
          pageCount
        }
      };

    } catch (error) {
      console.error('PDF conversion error:', error);
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }
}

export default StandardPdfConverter;
