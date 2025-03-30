// services/converter/text/pdfConverter.js


import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import crypto from 'crypto';
import * as fs from 'fs/promises';
import { promisify } from 'util';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Checks if a file exists
 * @param {string} path - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the poppler binary path based on the operating system
 * @returns {Promise<string>} Path to poppler binaries
 */
async function getPopplerPath() {
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
        const exists = await fileExists(pdfimagesPath);
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
 * @param {string} command - The command to execute
 * @returns {Promise<string>} Command output
 */
async function executePopplerCommand(originalCommand) {
  let command = originalCommand;
  
  try {
    if (process.platform === 'win32') {
      const popplerPath = await getPopplerPath();
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
 * Extracts images from PDF using poppler-utils with fallback
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} originalName - Original filename
 * @returns {Promise<Array>} Array of image objects
 */
async function extractImages(pdfPath, originalName) {
  // Declare tempDir at the top level so it's available in finally block
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
      await executePopplerCommand(command);

      // Process extracted images
      const files = await fs.readdir(tempDir);
      const imageFiles = files.filter(f => /\.(jpg|jpeg|png|ppm|pbm)$/i.test(f));

      for (const imageFile of imageFiles) {
        const imagePath = path.join(tempDir, imageFile);
        const stats = await fs.stat(imagePath);

        // Skip tiny images (likely artifacts)
        if (stats.size < 5120) continue;

        // Calculate image hash
        const imageBuffer = await fs.readFile(imagePath);
        const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

        // Check for duplicates
        if (imageHashes.has(hash)) continue;
        imageHashes.set(hash, true);

        const ext = path.extname(imageFile).slice(1);
        const baseName = path.basename(originalName, '.pdf');
        const newImageName = `${baseName}-image-${images.length + 1}.${ext}`;

        images.push({
          name: newImageName,
          data: imageBuffer.toString('base64'),
          type: `image/${ext}`,
          path: `attachments/${baseName}/${newImageName}`,
          hash: hash,
          size: stats.size
        });
      }

    } catch (error) {
      console.warn('Poppler extraction failed:', error);
      console.log('Attempting fallback image extraction...');
      return await extractImagesWithFallback(pdfPath, originalName);
    }

    return images;

  } catch (error) {
    console.error('Image extraction error:', error);
    return [];
  } finally {
    // Cleanup
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error);
    }
  }
}

/**
 * Fallback image extraction using pdf-lib
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} originalName - Original filename
 * @returns {Promise<Array>} Array of image objects
 */
async function extractImagesWithFallback(pdfPath, originalName) {
  // Declare variables at the top level
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
          if (!imageData || imageData.length < 5120) continue;

          const hash = crypto.createHash('sha256').update(imageData).digest('hex');
          if (imageHashes.has(hash)) continue;
          
          imageHashes.set(hash, true);

          // Determine format based on filter
          const filter = xObject.Filter?.name;
          const format = filter === 'DCTDecode' ? 'jpeg' : 'png';

          const baseName = path.basename(originalName, '.pdf');
          const imageName = `${baseName}-image-${i + 1}-${images.length + 1}.${format}`;

          images.push({
            name: imageName,
            data: imageData.toString('base64'),
            type: `image/${format}`,
            path: `attachments/${baseName}/${imageName}`,
            hash: hash,
            size: imageData.length,
            pageIndex: i
          });
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
 * Extract text from PDF using poppler-utils pdftotext
 * @param {string} pdfPath - Path to the PDF file
 * @param {boolean} preservePageInfo - Whether to preserve page information
 * @returns {Promise<{text: string, pageBreaks: Array<{pageNumber: number, position: number}>}>} - Extracted text content and page breaks
 */
async function extractText(pdfPath, preservePageInfo = false) {
  try {
    let text = '';
    let pageBreaks = [];
    
    // First, get the number of pages using pdfinfo
    const pdfInfoCommand = `pdfinfo "${pdfPath}"`;
    const pdfInfoOutput = await executePopplerCommand(pdfInfoCommand);
    
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
        let pageText = await executePopplerCommand(command);
        
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
        
      // Track page break positions but don't add page markers directly
      // The adapter will use PageMarkerService to add markers consistently
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
      text = await executePopplerCommand(command);
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
 * Validates PDF input buffer more thoroughly
 */
export function validatePdfInput(input) {
  try {
    if (!input || !Buffer.isBuffer(input)) {
      throw new Error('Invalid input: Expected a buffer');
    }

    // Check minimum size
    if (input.length < 1024) {
      throw new Error('Invalid PDF: File too small');
    }

    // Check PDF signature at start (%PDF-)
    const header = input.slice(0, 5).toString('ascii');
    if (header !== '%PDF-') {
      throw new Error('Invalid PDF format: Missing PDF header');
    }

    // Check for binary content marker after header
    const binaryMarker = input.slice(5, 8);
    if (!binaryMarker.includes(0x80)) {
      console.warn('PDF may be corrupted: Missing binary marker');
    }

    // Look for EOF marker
    const trailer = input.slice(-1024).toString('ascii');
    if (!trailer.includes('%%EOF')) {
      throw new Error('Invalid PDF format: Missing EOF marker');
    }

    return true;
  } catch (error) {
    console.error('PDF validation failed:', error);
    throw error;
  }
}

/**
 * Converter configuration object
 */
export const pdfConverterConfig = {
  name: 'PDF Converter',
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
 * Main converter function that transforms PDF to Markdown with images
 * @param {Buffer} input - The PDF file buffer
 * @param {string} originalName - Original filename for context
 * @param {string} [apiKey] - Optional API key (not used for PDF conversion)
 * @param {Object} [options] - Conversion options
 * @param {boolean} [options.preservePageInfo=false] - Whether to preserve page information
 * @returns {Promise<{content: string, images: Array, pageBreaks: Array}>} - Converted content, images, and page breaks
 */
export async function convertPdfToMarkdown(input, originalName, apiKey, options = {}) {
  // Declare tempDir at the top level of the function so it's available in finally block
  let tempDir;
  
  try {
    // Validate input
    validatePdfInput(input);

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
    const { text: textContent, pageBreaks } = await extractText(tempPdfPath, options.preservePageInfo);
    
    // Extract images (using existing code)
    const images = await extractImages(tempPdfPath, originalName);
    
    const baseName = path.basename(originalName, '.pdf');
    
    // Create frontmatter (modified to not rely on pdf-parse)
    // Remove temp_ prefix from title if present
    let cleanTitle = baseName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    const frontmatter = [
      '---',
      `title: ${cleanTitle}`,
      `created: ${new Date().toISOString()}`,
      `source: ${originalName}`,
      `type: pdf`,
      `image_count: ${images.length}`,
      `page_count: ${options.preservePageInfo ? pageBreaks.length + 1 : 1}`,
      '---',
      ''
    ].join('\n');

    // Process text content
    const processedText = textContent
      .replace(/(\r\n|\r|\n){3,}/g, '\n\n')
      .replace(/[^\S\r\n]+/g, ' ')
      .trim();

    // Add image references (using existing code)
    let imageSection = '';
    if (images.length > 0) {
      imageSection = '\n\n## Extracted Images\n\n' +
        images.map(img => 
          `![${img.name}](${img.path})`
        ).join('\n\n');
    }

    const markdownContent = [
      frontmatter,
      '## Content\n',
      processedText,
      imageSection
    ].join('\n');

    return {
      success: true,
      content: markdownContent,
      images: images,
      pageBreaks: options.preservePageInfo ? pageBreaks : undefined,
      stats: {
        inputSize: input.length,
        outputSize: markdownContent.length,
        imageCount: images.length
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

export default {
  convert: convertPdfToMarkdown,
  validate: validatePdfInput,
  config: pdfConverterConfig
};
