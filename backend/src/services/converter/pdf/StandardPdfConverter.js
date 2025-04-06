// services/converter/pdf/StandardPdfConverter.js

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import crypto from 'crypto';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import BasePdfConverter from './BasePdfConverter.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Standard PDF converter implementation using poppler-utils
 * Provides basic PDF conversion with image extraction and optional fallback
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
    requiresPoppler: true,
    options: {
      imageQuality: 300,
      minImageSize: 5120, // 5KB
      debug: false,
      popplerPath: process.env.POPPLER_PATH
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
   * Gets the poppler binary path based on the operating system
   * @private
   */
  async getPopplerPath() {
    if (process.platform === 'win32') {
      // Check common installation paths
      const possiblePaths = [
        'C:\\Program Files\\poppler-24.08.0\\Library\\bin',
        'C:\\Program Files\\poppler\\Library\\bin',
        'C:\\Program Files\\poppler-23.11.0\\Library\\bin',
        'C:\\Program Files (x86)\\poppler\\Library\\bin',
        'C:\\poppler\\Library\\bin',
        process.env.POPPLER_PATH
      ].filter(Boolean);

      for (const binPath of possiblePaths) {
        if (!binPath) continue;
        
        const pdfimagesPath = path.join(binPath, 'pdfimages.exe');
        console.log('Checking poppler path:', pdfimagesPath);
        
        try {
          const exists = await this.fileExists(pdfimagesPath);
          if (exists) {
            console.log('Found poppler at:', binPath);
            return binPath;
          }
        } catch (error) {
          console.warn(`Failed to check path ${binPath}:`, error);
        }
      }
      
      throw new Error('Poppler not found. Please install poppler-utils and set POPPLER_PATH environment variable.');
    }
    
    return ''; // Unix systems typically have it in PATH
  }

  /**
   * Executes poppler command with proper path handling
   * @private
   */
  async executePopplerCommand(originalCommand) {
    let command = originalCommand;
    
    try {
      if (process.platform === 'win32') {
        const popplerPath = await this.getPopplerPath();
        // Add poppler path to command
        if (command.startsWith('pdfimages')) {
          command = command.replace('pdfimages', `"${path.join(popplerPath, 'pdfimages.exe')}"`);
        } else if (command.startsWith('pdftotext')) {
          command = command.replace('pdftotext', `"${path.join(popplerPath, 'pdftotext.exe')}"`);
        } else if (command.startsWith('pdfinfo')) {
          command = command.replace('pdfinfo', `"${path.join(popplerPath, 'pdfinfo.exe')}"`);
        }
      }

      console.log('Executing command:', command);
      const { stdout, stderr } = await execAsync(command);
      
      if (stderr) {
        console.warn('Command stderr:', stderr);
      }
      
      return stdout;
    } catch (error) {
      console.error('Poppler command failed:', error);
      throw error;
    }
  }

  /**
   * Fallback image extraction using pdf-lib
   * @private
   */
  async extractImagesWithFallback(pdfPath, originalName) {
    let pdfDoc;
    const images = [];
    const imageHashes = new Map();

    try {
      const { PDFDocument } = await import('pdf-lib');
      console.log('📚 Loading PDF document for fallback extraction');
      const pdfBytes = await fs.readFile(pdfPath);
      pdfDoc = await PDFDocument.load(pdfBytes);
      
      console.log('📄 Processing PDF pages:', {
        pageCount: pdfDoc.getPageCount(),
        fileSize: pdfBytes.length
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
      console.error('Fallback image extraction failed:', error);
      return [];
    }
  }

  /**
   * Extract images from PDF using poppler-utils with fallback
   * @override
   */
  async extractImages(pdfPath, originalName) {
    let tempDir;
    let imageRoot;
    const images = [];
    const imageHashes = new Map();

    try {
      tempDir = path.join(process.cwd(), 'temp', uuidv4());
      imageRoot = path.join(tempDir, 'image');
      
      await fs.mkdir(tempDir, { recursive: true });

      try {
        // Use pdfimages for extraction
        const command = `pdfimages -all "${pdfPath}" "${imageRoot}"`;
        await this.executePopplerCommand(command);

        // Process extracted images
        const files = await fs.readdir(tempDir);
        const imageFiles = files.filter(f => /\.(jpg|jpeg|png|ppm|pbm)$/i.test(f));

        for (const imageFile of imageFiles) {
          const imagePath = path.join(tempDir, imageFile);
          const stats = await fs.stat(imagePath);

          // Skip tiny images (likely artifacts)
          if (stats.size < this.config.options.minImageSize) continue;

          // Calculate image hash
          const imageBuffer = await fs.readFile(imagePath);
          const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

          // Check for duplicates
          if (imageHashes.has(hash)) continue;
          imageHashes.set(hash, true);

          const ext = path.extname(imageFile).slice(1);
          const baseName = path.basename(originalName, '.pdf');
          const generatedPath = this.generateUniqueImageName(baseName, 0, ext);

          const imageObject = {
            name: generatedPath,
            data: imageBuffer.toString('base64'),
            type: `image/${ext}`,
            path: generatedPath,
            hash: hash,
            size: stats.size
          };

          if (this.validateImageObject(imageObject)) {
            images.push(imageObject);
            console.log(`📸 Added image: ${imageObject.name} (${stats.size} bytes, data: ${this.truncateBase64(imageObject.data)})`);
          } else {
            console.warn(`⚠️ Invalid image object structure for ${imageObject.name}`);
          }
        }

      } catch (error) {
        console.warn('Poppler extraction failed:', error);
        console.log('Attempting fallback image extraction...');
        return await this.extractImagesWithFallback(pdfPath, originalName);
      }

      return images;

    } catch (error) {
      console.error('Image extraction error:', error);
      return [];
    } finally {
      // Cleanup
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('Failed to cleanup temp directory:', error);
        }
      }
    }
  }

  /**
   * Extract text from PDF using poppler-utils pdftotext
   * @override
   */
  async extractText(pdfPath, preservePageInfo = false) {
    try {
      let text = '';
      let pageBreaks = [];
      
      // First, get the number of pages using pdfinfo
      const pdfInfoCommand = `pdfinfo "${pdfPath}"`;
      const pdfInfoOutput = await this.executePopplerCommand(pdfInfoCommand);
      
      // Parse the output to get the number of pages
      const pagesMatch = pdfInfoOutput.match(/Pages:\s+(\d+)/);
      const numPages = pagesMatch ? parseInt(pagesMatch[1], 10) : 0;
      
      console.log(`📄 PDF has ${numPages} pages`);
      
      if (preservePageInfo) {
        // Extract text page by page and add page markers
        let combinedText = '';
        
        for (let i = 1; i <= numPages; i++) {
          // Extract text for this page only
          const command = `pdftotext -f ${i} -l ${i} "${pdfPath}" -`;
          let pageText = await this.executePopplerCommand(command);
          
          // Trim leading/trailing whitespace from the page text
          pageText = pageText.trim();
          
          // Remove standalone page numbers that poppler might extract
          // Split into lines and check if the last line is just a number
          const lines = pageText.split('\n');
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            // Check if the last line is just a number (the page number)
            if (/^\d+$/.test(lastLine)) {
              // Remove the last line (page number)
              lines.pop();
              pageText = lines.join('\n');
            }
          }
          
          if (i > 1) {
            // Add a page break position
            pageBreaks.push({
              pageNumber: i,
              position: combinedText.length
            });
            
            // Add the page text with proper spacing
            combinedText += `\n\n${pageText}`;
          } else {
            // For the first page, just add the text
            combinedText += pageText;
          }
        }
        
        text = combinedText;
      } else {
        // Use pdftotext command from poppler to extract all text at once
        const command = `pdftotext "${pdfPath}" -`;
        text = await this.executePopplerCommand(command);
      }
      
      return {
        text: text.trim(),
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
   * Main converter function that transforms PDF to Markdown with images
   * @override
   */
  async convertPdfToMarkdown(input, originalName, apiKey, options = {}) {
    let tempDir;
    
    try {
      // Validate input
      this.validatePdfInput(input);

      tempDir = path.join(process.cwd(), 'temp', uuidv4());
      const tempPdfPath = path.join(tempDir, 'input.pdf');
      
      await fs.mkdir(tempDir, { recursive: true });

      // Write buffer with additional error handling
      try {
        await fs.writeFile(tempPdfPath, input, { flag: 'wx' });
      } catch (error) {
        throw new Error(`Failed to write PDF file: ${error.message}`);
      }

      // Check if file was written successfully
      const stats = await fs.stat(tempPdfPath);
      if (stats.size !== input.length) {
        throw new Error('PDF file corrupted during write');
      }

      // Extract text using poppler with page information if requested
      const { text: textContent, pageBreaks, pageCount } = await this.extractText(tempPdfPath, options.preservePageInfo);
      
      // Extract images
      const images = await this.extractImages(tempPdfPath, originalName);
      
      const baseName = path.basename(originalName, '.pdf');
      
      // Create metadata object
      const metadata = this.createMetadata(baseName, images.length, pageCount);

      // Process text content
      const processedText = textContent
        .replace(/(\r\n|\r|\n){3,}/g, '\n\n')
        .replace(/[^\S\r\n]+/g, ' ')
        .trim();

      // Add image references using Obsidian format
      let imageSection = '';
      if (images.length > 0) {
        imageSection = '\n\n## Extracted Images\n\n' +
          images.map(img => this.generateImageMarkdown(img.path)).join('\n\n');
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
    } finally {
      // Cleanup
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.warn('Failed to cleanup temp directory:', error);
        }
      }
    }
  }
}

export default StandardPdfConverter;
