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
const { formatMetadata } = require('../adapters/metadataExtractorAdapter');

/**
 * Helper function to escape special characters in strings for use in regular expressions
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

/**
 * Helper function to clean temporary filenames
 * Removes 'temp_' prefix and any numeric identifiers
 * @param {string} filename - The filename to clean
 * @returns {string} The cleaned filename
 */
function cleanTemporaryFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    console.warn(`⚠️ Invalid input to cleanTemporaryFilename: ${filename}`);
    return filename || '';
  }
  
  try {
    // Extract the base name without extension
    const extension = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    
    // Clean the base name - remove temp_ prefix and any numeric identifiers
    let cleanedName = baseName;
    if (baseName.startsWith('temp_')) {
      cleanedName = baseName.replace(/^temp_\d*_?/, '');
    }
    
    // Return the cleaned name with extension if it had one
    return cleanedName + extension;
  } catch (error) {
    console.error(`❌ Error in cleanTemporaryFilename:`, error);
    return filename;
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
    // Use provided output directory or fall back to default
    const baseOutputDir = outputDir || this.defaultOutputDir;
    
    // Determine if we should create a subdirectory
    const userProvidedOutputDir = !!outputDir;
    const createSubdirectory = userProvidedOutputDir ? false : 
                             (options.createSubdirectory !== undefined ? options.createSubdirectory : true);
    
    // Clean the name to remove any temporary filename patterns
    const cleanedName = cleanTemporaryFilename(name);
    
    // Generate base name and output path
    const baseName = cleanedName.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    const outputBasePath = createSubdirectory ? 
      path.join(baseOutputDir, `${baseName}_${Date.now()}`) : 
      baseOutputDir;

    // Create output directory
    await this.fileSystem.createDirectory(outputBasePath);

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

    // Clean any metadata fields that might contain temporary filenames
    const cleanedMetadata = { ...metadata };
    if (cleanedMetadata.originalFile && typeof cleanedMetadata.originalFile === 'string') {
      cleanedMetadata.originalFile = cleanTemporaryFilename(cleanedMetadata.originalFile);
    }
    
    // Create metadata object
    const fullMetadata = {
      type,
      converted: new Date().toISOString(),
      ...cleanedMetadata
    };

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

    // Return standardized result
    return {
      success: true,
      outputPath: outputBasePath,
      mainFile: mainFilePath,
      metadata: fullMetadata
    };
  }
}

module.exports = new ConversionResultManager();
