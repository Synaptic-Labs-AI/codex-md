// services/converter/textConverterFactory.js

import { convertPdfToMarkdown } from './text/pdfConverter.js';
import { convertDocxToMarkdown } from './text/docxConverter.js';
import { convertPptxToMarkdown } from './text/pptxConverter.js';
import { convertHtmlToMarkdown } from './text/htmlConverter.js';
import { convertCsvToMarkdown } from './data/csvConverter.js';
import { convertXlsxToMarkdown } from './data/xlsxConverter.js';
import { convertUrlToMarkdown } from './web/urlConverter.js';
import { convertParentUrlToMarkdown } from './web/parentUrlConverter.js';
// YouTube functionality temporarily removed
import { convertAudioToMarkdown } from './multimedia/audioconverter.js';
import { convertVideoToMarkdown } from './multimedia/videoConverter.js';

// File signatures for supported formats
const FILE_SIGNATURES = {
  docx: {
    bytes: [0x50, 0x4B, 0x03, 0x04], // PK\x03\x04 (ZIP format)
    description: 'DOCX/ZIP signature'
  },
  pdf: {
    bytes: [0x25, 0x50, 0x44, 0x46],  // %PDF
    description: 'PDF signature'
  },
  doc: {
    bytes: [0xD0, 0xCF, 0x11, 0xE0],  // DOC
    description: 'DOC signature'
  },
  pptx: {
    bytes: [0x50, 0x4B, 0x03, 0x04], // PK\x03\x04 (ZIP format)
    description: 'PPTX/ZIP signature'
  }
};

/**
 * Factory class for managing different types of Markdown converters
 */
class TextConverterFactory {
  /**
   * Initialize the converter factory with supported file type mappings
   */
  constructor() {
    this.converters = {
      // Text converters
      pdf: convertPdfToMarkdown,
      docx: convertDocxToMarkdown,
      pptx: convertPptxToMarkdown,
      html: convertHtmlToMarkdown,
      htm: convertHtmlToMarkdown, // Also support .htm extension

      // Data converters
      csv: convertCsvToMarkdown,
      xlsx: convertXlsxToMarkdown,

      // Web converters
      url: convertUrlToMarkdown,
      parenturl: convertParentUrlToMarkdown,

      // Multimedia converters  
      audio: convertAudioToMarkdown,
      video: convertVideoToMarkdown
    };

    // Map of expected input types for validation
    this.expectedInputTypes = {
      docx: ['buffer'],
      pdf: ['buffer'],
      pptx: ['buffer'],
      html: ['buffer', 'string'],
      htm: ['buffer', 'string'],
      url: ['string'],
      parenturl: ['string', 'object'],
      audio: ['buffer'],
      video: ['buffer']
    };

    console.log('Registered converters:', Object.keys(this.converters));
    console.log('Registered input types:', this.expectedInputTypes);
  }

  /**
   * Validates input type against expected types for the format
   * @private
   * @param {string} type - The file type
   * @param {any} input - The input to validate
   * @throws {Error} If input type is invalid
   */
  validateInput(type, input) {
    // Normalize type to lowercase
    const normalizedType = type.toLowerCase();

    // Special handling for docx files
    if (normalizedType === 'docx' && Buffer.isBuffer(input)) {
      // Check if buffer starts with PK (ZIP file magic number, which DOCX files should have)
      if (input[0] === 0x50 && input[1] === 0x4B) {
        return true;
      }
      throw new Error('Invalid DOCX file format');
    }

    // Add specific validation for PPTX
    if (normalizedType === 'pptx' && Buffer.isBuffer(input)) {
      // Check for ZIP/PPTX file signature (PK)
      if (input[0] === 0x50 && input[1] === 0x4B) {
        return true;
      }
      throw new Error('Invalid PPTX file format');
    }

    console.log('Validating input:', {
      originalType: type,
      normalizedType,
      inputType: typeof input,
      isBuffer: Buffer.isBuffer(input),
      expectedTypes: this.expectedInputTypes[normalizedType],
      input: Buffer.isBuffer(input)
        ? '[Buffer data]'
        : typeof input === 'object'
        ? JSON.stringify(input)
        : input
    });

    const expectedTypes = this.expectedInputTypes[normalizedType] || ['buffer', 'string'];
    const inputType = typeof input;
    const isBuffer = Buffer.isBuffer(input);

    // Special handling for parenturl type
    if (normalizedType === 'parenturl') {
      if (typeof input === 'string' || typeof input === 'object') {
        return true;
      }
    }

    if (isBuffer && !expectedTypes.includes('buffer')) {
      throw new Error(`${type} converter does not accept Buffer input`);
    }

    if (!expectedTypes.includes(inputType) && !isBuffer) {
      throw new Error(
        `Invalid input type for ${type}. Expected ${expectedTypes.join(' or ')}, got ${inputType}`
      );
    }
  }

  /**
   * Validates file signature for supported file types
   * @param {string} type - The file type
   * @param {Buffer} buffer - The buffer to validate
   * @returns {boolean} - True if signature is valid
   */
  validateFileSignature(type, buffer) {
    if (!Buffer.isBuffer(buffer)) {
      console.error('❌ Invalid buffer type:', typeof buffer);
      return false;
    }

    const fileType = type.toLowerCase();
    const signature = FILE_SIGNATURES[fileType];

    // If no signature defined for this type, consider it valid
    if (!signature) {
      console.log('ℹ️ No signature check required for:', fileType);
      return true;
    }

    // Ensure buffer is large enough
    if (buffer.length < signature.bytes.length) {
      console.error('❌ Buffer too small for signature check:', {
        type: fileType,
        bufferLength: buffer.length,
        requiredLength: signature.bytes.length,
        description: signature.description
      });
      return false;
    }

    const actualSignature = buffer.slice(0, signature.bytes.length);
    const isValid = actualSignature.equals(Buffer.from(signature.bytes));

    console.log('🔐 File signature validation:', {
      type: fileType,
      expected: Buffer.from(signature.bytes).toString('hex'),
      actual: actualSignature.toString('hex'),
      isValid: isValid,
      description: signature.description
    });

    return isValid;
  }

  /**
   * Validates buffer content
   * @param {Buffer} buffer - The buffer to validate
   * @param {string} type - The file type
   * @returns {boolean} - True if buffer is valid
   */
  validateBuffer(buffer, type) {
    console.log('🔍 Validating buffer:', {
      type,
      length: buffer?.length,
      head: buffer?.slice(0, 4).toString('hex')
    });

    return this.validateFileSignature(type, buffer);
  }

  /**
   * Converts input content to Markdown format
   * @param {string} type - The type of content
   * @param {Buffer|string|Object} input - The content to convert
   * @param {string} originalName - Original filename or identifier
   * @param {string} [apiKey] - API key for services that require authentication
   * @returns {Promise<{ content: string, images: Array }>} - Converted content and images
   */
  async convertToMarkdown(type, content, options = {}) {
    console.log('🔄 Starting conversion:', {
      type,
      contentType: typeof content,
      isBuffer: Buffer.isBuffer(content),
      options: Object.keys(options)
    });

    // Validate input based on type
    if (['docx', 'pdf', 'pptx'].includes(type)) {
      if (!Buffer.isBuffer(content)) {
        console.error('❌ Invalid content type:', {
          expected: 'Buffer',
          received: typeof content,
          type: type
        });
        throw new Error(`Invalid content for ${type}: Expected Buffer`);
      }

      // Log buffer validation
      console.log('🔍 Validating buffer:', {
        type,
        length: content.length,
        signature: content.slice(0, 4).toString('hex'),
        isValid: this.validateFileSignature(type, content)
      });
    } else if (type === 'url') {
      if (typeof content !== 'string') {
        console.error('❌ Invalid content type for URL:', {
          expected: 'string',
          received: typeof content
        });
        throw new Error('Invalid content for URL: Expected string');
      }
      
      // Basic URL validation
      try {
        new URL(content.startsWith('http') ? content : `https://${content}`);
      } catch (error) {
        console.error('❌ Invalid URL format:', content);
        throw new Error('Invalid URL format');
      }
      
      console.log('🔍 URL validation passed:', content);
    }

    // Normalize type to lowercase
    const fileType = type.toLowerCase();

    // Validate buffer for binary files
    if (['docx', 'pdf', 'pptx'].includes(fileType)) {
      if (!Buffer.isBuffer(content)) {
        throw new Error(`Invalid content for ${fileType}: Expected Buffer`);
      }
      
      // Validate file signature
      if (!this.validateFileSignature(fileType, content)) {
        throw new Error(`Invalid ${fileType.toUpperCase()} file signature`);
      }
    }

    // Route to correct converter with enhanced error handling
    try {
      switch (fileType) {
        case 'docx':
          console.log('📄 Converting DOCX document');
          return await convertDocxToMarkdown(content, options.name);
        case 'pdf':
          console.log('📄 Converting PDF document');
          return await convertPdfToMarkdown(content, options.name);
        case 'pptx':
          console.log('📄 Converting PPTX presentation');
          return await convertPptxToMarkdown(content, options.name);
        case 'html':
        case 'htm':
          console.log('🌐 Converting HTML document');
          return await convertHtmlToMarkdown(content, options.name);
        case 'csv':
          console.log('📊 Converting CSV data');
          return await convertCsvToMarkdown(content, options.name);
        case 'xlsx':
          console.log('📊 Converting XLSX spreadsheet');
          return await convertXlsxToMarkdown(content, options.name);
        case 'url':
          console.log('🌐 Converting URL content');
          return await convertUrlToMarkdown(content, options);
        case 'parenturl':
          console.log('🌐 Converting parent URL content');
          return await convertParentUrlToMarkdown(content, options);
        default:
          console.error('❌ Unsupported file type:', fileType);
          // Handle multimedia types
          if (fileType === 'audio') {
            console.log('🎵 Converting audio content');
            return await convertAudioToMarkdown(content, options.name, options.apiKey);
          }
          if (fileType === 'video') {
            console.log('🎥 Converting video content');
            return await convertVideoToMarkdown(content, options.name, options.apiKey);
          }
          throw new Error(`Unsupported file type: ${fileType}`);
      }
    } catch (error) {
      console.error(`❌ Conversion error for ${fileType}:`, {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Registers a new converter for a file type
   * @param {string} type - The file type
   * @param {Function} converterFunction - The converter function
   */
  addConverter(type, converterFunction) {
    if (typeof converterFunction !== 'function') {
      throw new Error('Converter must be a function');
    }
    this.converters[type.toLowerCase()] = converterFunction;
  }

  /**
   * Checks if the file type is an audio type
   * @param {string} type - The file type
   * @returns {boolean} - True if the file type is an audio type, false otherwise
   */
  isAudioType(type) {
    const audioTypes = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];
    return audioTypes.includes(type.toLowerCase());
  }
}

// Export singleton instance
export const textConverterFactory = new TextConverterFactory();
