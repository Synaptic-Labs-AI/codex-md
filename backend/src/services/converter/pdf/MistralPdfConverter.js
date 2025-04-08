// services/converter/pdf/MistralPdfConverter.js

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import FormData from 'form-data';
import BasePdfConverter from './BasePdfConverter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Advanced PDF converter implementation using Mistral's OCR API
 * Handles PDF conversion with OCR capabilities for better text extraction
 * 
 * Related files:
 * - BasePdfConverter.js: Parent abstract class
 * - StandardPdfConverter.js: Basic implementation using poppler
 */
export class MistralPdfConverter extends BasePdfConverter {
  /**
   * Configuration for the converter
   */
  config = {
    name: 'Mistral OCR PDF Converter',
    version: '1.0.0',
    supportedExtensions: ['.pdf'],
    supportedMimeTypes: ['application/pdf'],
    maxSizeBytes: 100 * 1024 * 1024, // 100MB
    requiresApi: true,
    options: {
      model: 'mistral-ocr-latest',
      includeImageBase64: true
    }
  };

  /**
   * Upload file to Mistral API
   * @private
   */
  async uploadFileToMistral(input, apiKey) {
    console.log('📤 Uploading file to Mistral API');
    const formData = new FormData();
    formData.append('purpose', 'ocr');
    formData.append('file', input, {
      filename: 'document.pdf',
      contentType: 'application/pdf'
    });

    const response = await fetch('https://api.mistral.ai/v1/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral file upload failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const fileData = await response.json();
    console.log('📤 File uploaded successfully:', {
      fileId: fileData.id,
      size: fileData.size_bytes
    });

    return fileData.id;
  }

  /**
   * Get signed URL for a file
   * @private
   */
  async getSignedUrl(fileId, apiKey) {
    console.log('🔗 Getting signed URL for file:', fileId);
    const response = await fetch(`https://api.mistral.ai/v1/files/${fileId}/url`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get signed URL: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const urlData = await response.json();
    console.log('🔗 Got signed URL');
    return urlData.url;
  }

  /**
   * Delete a file from Mistral's API
   * @private
   */
  async deleteFile(fileId, apiKey) {
    console.log('🗑️ Deleting file:', fileId);
    const response = await fetch(`https://api.mistral.ai/v1/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`⚠️ Failed to delete file: ${response.status} ${response.statusText}\n${errorText}`);
      return false;
    }

    console.log('✅ File deleted successfully');
    return true;
  }

  /**
   * Process OCR result into expected format
   * @private
   */
  processOcrResult(ocrResult, originalName) {
    // Convert OCR result to markdown
    let markdown = '';
    const images = [];
    const pageBreaks = [];
    let currentPosition = 0;
    
    // Create a mapping between Mistral's image IDs and our generated image paths
    const imageIdToPathMap = {};
    
    // First pass: extract images and create the mapping
    for (let i = 0; i < ocrResult.pages.length; i++) {
      const page = ocrResult.pages[i];
      
      // Extract images if available
      if (page.images && page.images.length > 0) {
        for (const image of page.images) {
          if (image.image_base64) {
            const baseName = path.basename(originalName, '.pdf');
            const generatedPath = this.generateUniqueImageName(baseName, page.index - 1, 'jpeg');

            // Extract the actual base64 data, removing any data URL prefix
            let base64Data = image.image_base64;
            if (typeof base64Data === 'string' && base64Data.startsWith('data:')) {
              console.log(`🔍 Detected data URL prefix in image on page ${page.index}, extracting base64 data`);
              base64Data = base64Data.split(',')[1];
            }

            const imageObject = {
              data: Buffer.from(base64Data, 'base64'),
              pageIndex: page.index - 1,
              name: generatedPath,
              type: 'image/jpeg',
              path: generatedPath,
              size: Buffer.from(base64Data, 'base64').length
            };

            if (this.validateImageObject(imageObject)) {
              // Add to images array
              images.push(imageObject);
              
              // Add to mapping
              if (image.id) {
                imageIdToPathMap[image.id] = generatedPath;
                console.log(`📸 Added OCR image mapping: ${image.id} -> ${generatedPath}`);
              }
              
              console.log(`📸 Added OCR image on page ${page.index} (${this.truncateBase64(base64Data)})`);
            } else {
              console.warn(`⚠️ Invalid OCR image object on page ${page.index}`);
            }
          }
        }
      }
    }
    
    // Second pass: process markdown content and replace image references
    for (let i = 0; i < ocrResult.pages.length; i++) {
      const page = ocrResult.pages[i];
      
      // Replace image references in the markdown content
      let pageMarkdown = page.markdown;
      
      // Replace standard Markdown image links with Obsidian format
      const markdownImageRegex = /!\[(.*?)\]\((.*?)\)/g;
      pageMarkdown = pageMarkdown.replace(markdownImageRegex, (match, alt, src) => {
        // Extract the image ID from the src
        const imageId = path.basename(src);
        
        // If we have a mapping for this image ID, use the Obsidian format
        if (imageIdToPathMap[imageId]) {
          return this.generateImageMarkdown(imageIdToPathMap[imageId]);
        }
        
        // Otherwise, keep the original reference
        return match;
      });
      
      // Add page content
      markdown += pageMarkdown + '\n\n';
      
      // Calculate page breaks
      if (i < ocrResult.pages.length - 1) {
        currentPosition += pageMarkdown.length + 2; // +2 for the newlines
        pageBreaks.push({
          pageNumber: i + 2, // +2 because we're using 1-based page numbers
          position: currentPosition
        });
      }
    }
    
    return {
      markdown,
      images,
      pageBreaks,
      pageCount: ocrResult.pages.length
    };
  }

  /**
   * Process PDF with Mistral OCR
   * @private
   */
  async processPdfWithMistralOcr(input, originalName, apiKey) {
    console.log(`⏳ Processing PDF with Mistral OCR: ${originalName}`);
    let fileId;
    
    try {
      // Upload file
      fileId = await this.uploadFileToMistral(input, apiKey);
      
      // Get signed URL
      const signedUrl = await this.getSignedUrl(fileId, apiKey);

      // Call Mistral OCR API with signed URL
      console.log('🔍 Calling Mistral OCR API');
      const response = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.options.model,
          document: {
            type: 'document_url',
            document_url: signedUrl
          },
          include_image_base64: this.config.options.includeImageBase64
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Mistral OCR API error: ${response.status} ${response.statusText}`);
        console.error(`❌ Error details:`, errorText);
        throw new Error(`Mistral OCR API error: ${response.status} ${response.statusText}`);
      }
      
      const ocrResult = await response.json();
      console.log(`✅ Mistral OCR successful:`, {
        pageCount: ocrResult.pages.length,
        firstPageSample: ocrResult.pages[0]?.markdown?.substring(0, 100) + '...'
      });
      
      return ocrResult;
    } finally {
      // Clean up uploaded file
      if (fileId) {
        try {
          await this.deleteFile(fileId, apiKey);
        } catch (cleanupError) {
          console.warn('⚠️ Failed to clean up uploaded file:', cleanupError);
        }
      }
    }
  }

  /**
   * Extract images and text using Mistral OCR
   * @override
   */
  async extractImages(pdfPath, originalName) {
    // Images are extracted as part of the OCR process
    // This method is called internally by convertPdfToMarkdown
    return [];
  }

  /**
   * Extract text using Mistral OCR
   * @override
   */
  async extractText(pdfPath, preservePageInfo = false) {
    // Text is extracted as part of the OCR process
    // This method is called internally by convertPdfToMarkdown
    return {
      text: '',
      pageBreaks: [],
      pageCount: 0
    };
  }

  /**
   * Convert PDF to Markdown using Mistral OCR
   * @override
   */
  async convertPdfToMarkdown(input, originalName, apiKey, options = {}) {
    console.log('🔍 MistralPdfConverter: Starting OCR conversion process');
    
    // Validate Mistral API key
    if (!apiKey) {
      throw new Error('Mistral API key is required for OCR conversion. Please add a Mistral API key in Settings.');
    }
    
    // Check if the API key looks valid (basic format check)
    if (!apiKey.startsWith('mis_') && !apiKey.startsWith('sk-')) {
      console.warn('⚠️ Mistral API key format looks incorrect. Keys typically start with "mis_" or "sk-"');
    } else {
      console.log('✅ Mistral API key format looks valid');
    }
    
    console.log(`📄 Processing PDF: ${originalName} (${input.length} bytes) with Mistral OCR`);

    try {
      // Validate input
      this.validatePdfInput(input);

      // Process with Mistral OCR
      const ocrResult = await this.processPdfWithMistralOcr(input, originalName, apiKey);
      
      // Process OCR result
      const { markdown, images, pageBreaks, pageCount } = this.processOcrResult(ocrResult, originalName);
      
      const baseName = path.basename(originalName, '.pdf');
      
      // Create metadata object
      const metadata = this.createMetadata(baseName, images.length, pageCount);

      // Process text content
      const processedText = markdown
        .replace(/(\r\n|\r|\n){3,}/g, '\n\n')
        .replace(/[^\S\r\n]+/g, ' ')
        .trim();

      // No need to add a separate "Extracted Images" section since images are now referenced inline
      const content = [
        `# PDF: ${baseName}`,
        '',
        processedText
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
      console.error('OCR conversion error:', error);
      throw new Error(`OCR conversion failed: ${error.message}`);
    }
  }
}

export default MistralPdfConverter;
