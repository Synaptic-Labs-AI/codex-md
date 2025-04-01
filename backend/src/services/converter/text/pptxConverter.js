// services/converter/text/pptxConverter.js

import JSZip from 'jszip';
import TurndownService from 'turndown';
import path from 'path';

/**
 * PPTX Converter configuration
 */
export const pptxConverterConfig = {
  name: 'PPTX Converter',
  version: '1.0.0',
  supportedExtensions: ['.pptx'],
  supportedMimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
};

/**
 * Simple XML text extractor using regex
 * @param {string} xml - XML content
 * @returns {string} - Extracted text
 */
function extractTextFromXml(xml) {
  // Extract text between <a:t> tags
  const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
  return matches
    .map(match => match.replace(/<a:t>|<\/a:t>/g, ''))
    .join(' ')
    .trim();
}

/**
 * Validates that the input is a valid PPTX file
 * @param {Buffer} input - The PPTX file buffer
 * @returns {boolean} - True if valid, throws error if invalid
 */
function validatePptxInput(input) {
  // Check if input is a buffer
  if (!Buffer.isBuffer(input)) {
    throw new Error(`Invalid input: Expected a buffer, got ${typeof input}`);
  }
  
  // Check minimum size
  if (input.length < 1024) {
    throw new Error(`Invalid PPTX file: File too small (${input.length} bytes)`);
  }
  
  // Check for ZIP signature (PK header)
  if (input.length < 4 || input[0] !== 0x50 || input[1] !== 0x4B) {
    throw new Error(`Invalid PPTX file: Missing ZIP signature, got ${input.slice(0, 4).toString('hex')}`);
  }
  
  return true;
}

/**
 * Converts a PPTX buffer to Markdown format, extracting text and images.
 * @param {Buffer} input - The PPTX file buffer.
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array }>} - Converted content and images.
 * @throws {Error} - If conversion fails.
 */
export async function convertPptxToMarkdown(input, originalName, apiKey) {
  try {
    console.log(`🔄 [pptxConverter] Starting conversion for: ${originalName}`);
    console.log(`📊 [pptxConverter] Input buffer stats: ${input ? input.length : 'null'} bytes, isBuffer: ${Buffer.isBuffer(input)}`);
    
    // Validate input
    validatePptxInput(input);
    
    // Log first few bytes to help diagnose format issues
    if (input.length >= 16) {
      console.log(`📊 [pptxConverter] First 16 bytes: ${input.slice(0, 16).toString('hex')}`);
    }
    
    console.log(`🔄 [pptxConverter] Loading ZIP file...`);
    const zip = await JSZip.loadAsync(input);
    console.log(`✅ [pptxConverter] ZIP loaded successfully`);
    
    // Log ZIP contents to help diagnose issues
    const zipFiles = Object.keys(zip.files);
    console.log(`📊 [pptxConverter] ZIP contains ${zipFiles.length} files`);
    console.log(`📊 [pptxConverter] First 5 files: ${zipFiles.slice(0, 5).join(', ')}`);
    
    const presentationName = path.basename(originalName, path.extname(originalName));
    
    // Extract slides content
    const slideFiles = Object.keys(zip.files)
      .filter(fileName => /^ppt\/slides\/slide\d+\.xml$/.test(fileName))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)\.xml/)[1]);
        const numB = parseInt(b.match(/slide(\d+)\.xml/)[1]);
        return numA - numB;
      });

    // Initialize markdown content with metadata
    let markdown = [
      `# ${presentationName}`,
      '',
      '---',
      'type: presentation',
      `created: ${new Date().toISOString()}`,
      `original: ${originalName}`,
      '---',
      '',
      ''
    ].join('\n');

    const images = [];

    // Process each slide
    for (const slideFileName of slideFiles) {
      const slideNumber = slideFileName.match(/slide(\d+)\.xml/)[1];
      const slideXml = await zip.file(slideFileName).async('string');
      const slideText = extractTextFromXml(slideXml);
      
      markdown += `## Slide ${slideNumber}\n\n`;
      
      // Extract images for this slide
      const slideImages = await extractImagesForSlide(zip, slideNumber, presentationName);
      images.push(...slideImages);
      
      // Add image references using Obsidian attachment format
      slideImages.forEach(img => {
        markdown += `![[${img.filename}]]\n\n`;
      });
      
      // Add slide text content
      if (slideText) {
        markdown += `${slideText}\n\n`;
      }
      
      markdown += `---\n\n`;
    }

    return {
      content: markdown.trim(),
      images: images.map(img => ({
        name: img.filename,
        data: img.data,
        type: img.type,
        // Ensure path follows Obsidian attachment structure
        path: `images/${presentationName}/${img.filename}`
      }))
    };
  } catch (error) {
    console.error('PPTX conversion error:', error);
    throw error;
  }
}

async function extractImagesForSlide(zip, slideNumber, presentationName) {
  const images = [];
  const mediaFolder = zip.folder('ppt/media');
  
  if (mediaFolder) {
    // Get relationship file for this slide
    const relsFile = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const relsContent = await zip.file(relsFile)?.async('string');
    
    if (relsContent) {
      // Find image references in relationships
      const imageRefs = relsContent.match(/Target="\.\.\/media\/[^"]+"/g) || [];
      
      for (const ref of imageRefs) {
        const imageFile = ref.match(/media\/([^"]+)/)[1];
        const file = mediaFolder.file(imageFile);
        
        if (file && /\.(png|jpg|jpeg|gif|svg)$/i.test(imageFile)) {
          const imageData = await file.async('base64');
          const extension = path.extname(imageFile);
          const filename = `${presentationName}_slide${slideNumber}_${path.basename(imageFile)}`;
          
          images.push({
            filename,
            data: imageData,
            type: `image/${extension.slice(1).toLowerCase()}`,
            slideNumber: parseInt(slideNumber)
          });
        }
      }
    }
  }
  
  return images;
}

/**
 * Default export with methods for the adapter to use
 */
export default {
  convert: convertPptxToMarkdown,
  config: pptxConverterConfig
};
