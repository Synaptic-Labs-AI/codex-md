/**
 * BasePdfConverter.js
 * Base class for PDF converters in the Electron main process.
 * 
 * This base converter:
 * - Defines common PDF conversion functionality
 * - Provides shared utilities for PDF processing
 * - Implements common metadata extraction
 * - Handles page management and extraction
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - StandardPdfConverter.js: Standard PDF text extraction
 * - MistralPdfConverter.js: OCR-based PDF conversion
 * - FileStorageService.js: For temporary file management
 */

const path = require('path');
const crypto = require('crypto');
const BaseService = require('../../BaseService');

class BasePdfConverter extends BaseService {
    constructor(fileProcessor, fileStorage) {
        super();
        this.fileProcessor = fileProcessor;
        this.fileStorage = fileStorage;
        this.supportedExtensions = ['.pdf'];
        this.activeConversions = new Map();
    }

    /**
     * Set up IPC handlers for PDF conversion
     * Note: This should be implemented by subclasses
     */
    setupIpcHandlers() {
        // To be implemented by subclasses
        console.log(`[${this.constructor.name}] setupIpcHandlers not implemented`);
    }

    /**
     * Generate a unique conversion ID
     * @returns {string} Unique conversion ID
     */
    generateConversionId() {
        return crypto.randomBytes(8).toString('hex');
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
                conversion.window.webContents.send('pdf:conversion-progress', {
                    conversionId,
                    status,
                    ...details
                });
            }
        }
    }

    /**
     * Format page count for display
     * @param {number} count - Page count
     * @returns {string} Formatted page count
     */
    formatPageCount(count) {
        return `${count} page${count !== 1 ? 's' : ''}`;
    }

    /**
     * Format file size in bytes to human-readable format
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted file size
     */
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }

    /**
     * Generate markdown header for PDF document
     * @param {Object} metadata - PDF metadata
     * @param {Object} options - Conversion options
     * @returns {string[]} Array of markdown lines
     */
    generateMarkdownHeader(metadata, options) {
        const markdown = [];
        
        // Add title
        if (options.title) {
            markdown.push(`# ${options.title}`);
        } else if (metadata.title) {
            markdown.push(`# ${metadata.title}`);
        } else {
            markdown.push(`# PDF Document: ${metadata.filename}`);
        }
        
        markdown.push('');
        
        // Add metadata
        markdown.push('## Document Information');
        markdown.push('');
        markdown.push('| Property | Value |');
        markdown.push('| --- | --- |');
        markdown.push(`| Filename | ${metadata.filename} |`);
        markdown.push(`| Pages | ${this.formatPageCount(metadata.pageCount)} |`);
        
        if (metadata.title) markdown.push(`| Title | ${metadata.title} |`);
        if (metadata.author) markdown.push(`| Author | ${metadata.author} |`);
        if (metadata.subject) markdown.push(`| Subject | ${metadata.subject} |`);
        if (metadata.keywords) markdown.push(`| Keywords | ${metadata.keywords} |`);
        if (metadata.creator) markdown.push(`| Creator | ${metadata.creator} |`);
        if (metadata.producer) markdown.push(`| Producer | ${metadata.producer} |`);
        if (metadata.creationDate) markdown.push(`| Created | ${metadata.creationDate} |`);
        if (metadata.modificationDate) markdown.push(`| Modified | ${metadata.modificationDate} |`);
        
        markdown.push(`| File Size | ${this.formatFileSize(metadata.fileSize)} |`);
        
        markdown.push('');
        
        return markdown;
    }

    /**
     * Check if this converter supports the given file
     * @param {string} filePath - Path to file
     * @returns {boolean} True if supported
     */
    supportsFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.includes(ext);
    }

    /**
     * Get converter information
     * @returns {Object} Converter details
     */
    getInfo() {
        return {
            name: 'Base PDF Converter',
            extensions: this.supportedExtensions,
            description: 'Base class for PDF converters',
            options: {
                title: 'Optional document title',
                includeImages: 'Whether to include page images (default: false)',
                maxPages: 'Maximum pages to convert (default: all)'
            }
        };
    }
}

module.exports = BasePdfConverter;
