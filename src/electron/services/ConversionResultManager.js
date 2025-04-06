/**
 * ConversionResultManager.js
 * 
 * Handles saving conversion results to disk with consistent file handling.
 * Manages output directory structure, image saving, and metadata formatting.
 * 
 * Related files:
 * - src/electron/services/ElectronConversionService.js: Uses this service for saving conversion results
 * - src/electron/services/FileSystemService.js: Used for file system operations
 * - src/electron/adapters/metadataExtractorAdapter.js: Used for metadata formatting
 */

const path = require('path');
const { app } = require('electron');
const FileSystemService = require('./FileSystemService');
const { formatMetadata, cleanMetadata } = require('@codex-md/shared/utils/markdown');
const { cleanTemporaryFilename, getBasename } = require('@codex-md/shared/utils/files');

/**
 * Helper function to escape special characters in regular expressions
 * @param {string} string - The string to escape
 * @returns {string} The escaped string
 */
function escapeRegExp(string) {
  // Handle null, undefined, or non-string inputs
  if (string === null || string === undefined || typeof string !== 'string') {
    console.warn(`⚠️ Invalid input to escapeRegExp: ${string}`);
    return '';
  }
  
  try {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  } catch (error) {
    console.error(`❌ Error in escapeRegExp:`, error);
    return '';
  }
}

class ConversionResultManager {
  constructor() {
    this.fileSystem = FileSystemService;
    this.defaultOutputDir = path.join(app.getPath('userData'), 'conversions');
    
    console.log('ConversionResultManager initialized with default output directory:', this.defaultOutputDir);
  }

  /**
   * Update image references to use Obsidian format
   * @private
   * @param {string} content - The content to update
   * @param {Array} images - Array of image objects
   * @returns {string} Updated content with Obsidian image references
   */
  updateImageReferences(content, images) {
    // Validate inputs
    if (!content || typeof content !== 'string') {
      console.warn('⚠️ Invalid content provided to updateImageReferences');
      return content || '';
    }
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      return content;
    }
    
    let updatedContent = content;
    
    try {
      // First, handle any generic standard Markdown image links that might not be associated with our images
      // This is especially important for Mistral OCR results
      const genericMarkdownPattern = /!\[(.*?)\]\((.*?)\)/g;
      const processedImageIds = new Set();
      
      // Create a map of image paths for quick lookup
      const imagePaths = new Map();
      images.forEach(image => {
        if (image && typeof image === 'object') {
          const imagePath = image.path || image.name || (image.src ? image.src : null);
          if (imagePath) {
            // Store both the full path and the basename for matching
            imagePaths.set(imagePath, imagePath);
            imagePaths.set(path.basename(imagePath), imagePath);
          }
        }
      });
      
      // Replace generic Markdown image links with Obsidian format if we have a matching image
      updatedContent = updatedContent.replace(genericMarkdownPattern, (match, alt, src) => {
        // Extract the image ID from the src
        const imageId = path.basename(src);
        
        // If we have a matching image, use the Obsidian format
        if (imagePaths.has(imageId) || imagePaths.has(src)) {
          const imagePath = imagePaths.get(imageId) || imagePaths.get(src);
          processedImageIds.add(imageId);
          return `![[${imagePath}]]`;
        }
        
        // Otherwise, keep the original reference
        return match;
      });
      
      // Now process each image specifically
      images.forEach(image => {
        // Skip invalid image objects
        if (!image || typeof image !== 'object') {
          console.warn('⚠️ Invalid image object in updateImageReferences:', image);
          return;
        }
        
        try {
          // Determine the image path to use
          const imagePath = image.path || image.name || (image.src ? image.src : null);
          
          if (!imagePath) {
            console.warn('⚠️ Image object has no path, name, or src:', image);
            return;
          }
          
          // Skip if we already processed this image in the generic pass
          const imageId = path.basename(imagePath);
          if (processedImageIds.has(imageId)) {
            return;
          }
          
          // First replace standard markdown image syntax
          if (image.src) {
            const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(image.src)}[^)]*\\)`, 'g');
            updatedContent = updatedContent.replace(markdownPattern, `![[${imagePath}]]`);
          }
          
          // Replace standard markdown image syntax with any path
          const markdownAnyPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(imagePath)}[^)]*\\)`, 'g');
          updatedContent = updatedContent.replace(markdownAnyPattern, `![[${imagePath}]]`);
          
          // Replace any existing Obsidian syntax that doesn't match our expected format
          const obsidianPattern = new RegExp(`!\\[\\[[^\\]]*\\]\\]`, 'g');
          
          // Only replace if it's not already in the correct format
          const correctObsidianFormat = `![[${imagePath}]]`;
          if (!updatedContent.includes(correctObsidianFormat)) {
            // Find all Obsidian image references
            const matches = updatedContent.match(obsidianPattern);
            if (matches) {
              // Replace only those that contain parts of our image path
              matches.forEach(match => {
                // Extract the path from the match
                const matchPath = match.substring(3, match.length - 2);
                
                // Check if this match is related to our image
                if (matchPath.includes(path.basename(imagePath, path.extname(imagePath)))) {
                  updatedContent = updatedContent.replace(match, correctObsidianFormat);
                }
              });
            }
          }
        } catch (imageError) {
          console.warn(`⚠️ Error processing image reference:`, imageError);
          // Continue with next image
        }
      });
      
      // Finally, remove any "Extracted Images" section that might have been added
      const extractedImagesPattern = /\n\n## Extracted Images\n\n(?:!\[\[[^\]]+\]\]\n\n)*/g;
      updatedContent = updatedContent.replace(extractedImagesPattern, '');
      
    } catch (error) {
      console.error('❌ Error in updateImageReferences:', error);
      // Return original content on error
      return content;
    }

    return updatedContent;
  }

  /**
   * Saves conversion result to disk with consistent file handling
   * @param {Object} options - Options for saving the conversion result
   * @param {string} options.content - The content to save
   * @param {Object} [options.metadata={}] - Metadata to include in the frontmatter
   * @param {Array} [options.images=[]] - Array of image objects to save
   * @param {string} options.name - Base name for the output file/directory
   * @param {string} options.type - Type of content (e.g., 'pdf', 'url', etc.)
   * @param {string} [options.outputDir] - Custom output directory
   * @param {Object} [options.options={}] - Additional options
   * @returns {Promise<Object>} Result of the save operation
   */
  async saveConversionResult({ content, metadata = {}, images = [], name, type, outputDir, options = {} }) {
    console.log(`🔄 [ConversionResultManager] Saving conversion result for ${name} (${type})`);
    
    // Validate required parameters
    if (!content) {
      console.error('❌ [ConversionResultManager] No content provided!');
      throw new Error('Content is required for conversion result');
    }
    
    if (!name) {
      console.error('❌ [ConversionResultManager] No name provided!');
      throw new Error('Name is required for conversion result');
    }
    
    if (!type) {
      console.error('❌ [ConversionResultManager] No type provided!');
      throw new Error('Type is required for conversion result');
    }
    
    if (!outputDir) {
      console.error('❌ [ConversionResultManager] No output directory provided!');
      console.log('⚠️ [ConversionResultManager] Using default output directory:', this.defaultOutputDir);
    }
    
    // Use provided output directory or fall back to default
    const baseOutputDir = outputDir || this.defaultOutputDir;
    
    // Determine if we should create a subdirectory
    const userProvidedOutputDir = !!outputDir;
    const createSubdirectory = userProvidedOutputDir ? false : 
                             (options.createSubdirectory !== undefined ? options.createSubdirectory : true);
    
    // Clean the name to remove any temporary filename patterns
    const cleanedName = cleanTemporaryFilename(name);
    
    // Get the base name without extension and sanitize it
    const baseName = getBasename(cleanedName).replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    const outputBasePath = createSubdirectory ? 
      path.join(baseOutputDir, `${baseName}_${Date.now()}`) : 
      baseOutputDir;

    console.log(`📁 [ConversionResultManager] Generated output path: ${outputBasePath}`);

    // Create output directory
    try {
      await this.fileSystem.createDirectory(outputBasePath);
      console.log(`✅ [ConversionResultManager] Created output directory: ${outputBasePath}`);
    } catch (error) {
      console.error(`❌ [ConversionResultManager] Failed to create output directory: ${error.message}`);
      throw new Error(`Failed to create output directory: ${error.message}`);
    }

    // Create images directory if we have images
    if (images && images.length > 0) {
      // Group images by their directory paths
      const imagesByDir = new Map();
      
      for (const image of images) {
        if (!image || !image.path) {
          console.warn(`⚠️ Invalid image object or missing path:`, image);
          continue;
        }
        
        // Extract the directory part from the image path
        const dirPath = path.dirname(image.path);
        
        if (!imagesByDir.has(dirPath)) {
          imagesByDir.set(dirPath, []);
        }
        
        imagesByDir.get(dirPath).push(image);
      }
      
      // Create each unique directory and save its images
      for (const [dirPath, dirImages] of imagesByDir.entries()) {
        const fullDirPath = path.join(outputBasePath, dirPath);
        console.log(`📁 Creating images directory: ${fullDirPath}`);
        await this.fileSystem.createDirectory(fullDirPath);
        
        // Save images to their respective directories
        for (const image of dirImages) {
          if (image && image.data) {
            try {
              const imagePath = path.join(outputBasePath, image.path);
              console.log(`💾 Saving image: ${imagePath}`);
              
              // Ensure the image data is in the right format
              const imageData = Buffer.isBuffer(image.data) 
                ? image.data 
                : (typeof image.data === 'string' && image.data.startsWith('data:'))
                  ? Buffer.from(image.data.split(',')[1], 'base64')
                  : Buffer.from(image.data, 'base64');
                  
              await this.fileSystem.writeFile(imagePath, imageData);
            } catch (imageError) {
              console.error(`❌ Failed to save image: ${image.path}`, imageError);
            }
          } else {
            console.warn(`⚠️ Invalid image object:`, image);
          }
        }
      }
    }

    // Determine main file path
    const mainFilePath = createSubdirectory ? 
      path.join(outputBasePath, 'document.md') : 
      path.join(outputBasePath, `${baseName}.md`);

    // Update image references to use Obsidian format
    const updatedContent = this.updateImageReferences(content, images);

    // Clean metadata fields and create metadata object
    const fullMetadata = cleanMetadata({
      type,
      converted: new Date().toISOString(),
      ...metadata
    });

    // Check if content already has frontmatter
    const hasFrontmatter = updatedContent.trim().startsWith('---');
    
    let fullContent;
    
    if (hasFrontmatter) {
      // Content already has frontmatter, use it as is
      console.log('Content already has frontmatter, using as is');
      fullContent = updatedContent;
    } else {
      // Use the formatMetadata function from the adapter
      const frontmatter = formatMetadata(fullMetadata);
      
      // Combine frontmatter and content
      fullContent = frontmatter + updatedContent;
    }

    // Save the markdown content
    await this.fileSystem.writeFile(mainFilePath, fullContent);

    // Log the result details
    console.log('💾 Conversion result saved:', {
      outputPath: outputBasePath,
      mainFile: mainFilePath,
      hasImages: images && images.length > 0,
      imageCount: images ? images.length : 0,
      contentLength: fullContent.length
    });
    
    // Special handling for data files (CSV, XLSX)
    const isDataFile = type === 'csv' || type === 'xlsx';
    if (isDataFile) {
      console.log(`📊 [ConversionResultManager] Special handling for data file: ${type}`);
      
      // Ensure we have all required properties for data files
      if (!metadata.format) {
        metadata.format = type;
      }
      
      if (!metadata.type) {
        metadata.type = 'spreadsheet';
      }
      
      // Add additional logging for data files
      console.log(`📊 [ConversionResultManager] Data file metadata:`, metadata);
    }
    
    // Ensure we have a valid output path
    if (!outputBasePath) {
      console.error('❌ [ConversionResultManager] No output path generated!');
      throw new Error('Failed to generate output path');
    }
    
    // Return standardized result with guaranteed outputPath
    const result = {
      success: true,
      outputPath: outputBasePath,
      mainFile: mainFilePath,
      metadata: fullMetadata
    };
    
    console.log(`✅ [ConversionResultManager] Successfully saved conversion result:`, {
      type,
      outputPath: outputBasePath,
      mainFile: mainFilePath
    });
    
    return result;
  }
}

module.exports = new ConversionResultManager();
