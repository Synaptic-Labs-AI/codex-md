"use strict";

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
const {
  app
} = require('electron');
const {
  instance: FileSystemService
} = require('./FileSystemService'); // Import instance
const {
  formatMetadata,
  cleanMetadata,
  extractFrontmatter,
  mergeMetadata
} = require('../utils/markdown');
const {
  cleanTemporaryFilename,
  getBasename,
  generateUrlFilename
} = require('../utils/files');

/**
 * Generate appropriate filename based on conversion type and metadata
 * @private
 * @param {string} originalName - Original filename or URL
 * @param {string} type - Type of conversion (e.g., 'url', 'pdf')
 * @param {Object} metadata - Metadata from conversion
 * @returns {string} The appropriate filename
 */
function generateAppropriateFilename(originalName, type, metadata = {}) {
  if (type === 'url' && metadata.source_url) {
    return generateUrlFilename(metadata.source_url);
  }

  // For regular files, clean the original name
  return cleanTemporaryFilename(originalName);
}

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

/**
 * Helper function to check if a path is a URL
 * @param {string} path - The path to check
 * @returns {boolean} True if the path is a URL
 */
function isUrl(path) {
  return typeof path === 'string' && (path.startsWith('http://') || path.startsWith('https://'));
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
      // But preserve URL images in standard Markdown format
      updatedContent = updatedContent.replace(genericMarkdownPattern, (match, alt, src) => {
        // If it's a URL, keep it in standard Markdown format
        if (isUrl(src)) {
          return match;
        }

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
            // Skip URL images - keep them in standard Markdown format
            if (!isUrl(image.src)) {
              const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(image.src)}[^)]*\\)`, 'g');
              updatedContent = updatedContent.replace(markdownPattern, `![[${imagePath}]]`);
            }
          }

          // Replace standard markdown image syntax with any path
          // Skip URL images - keep them in standard Markdown format
          if (!isUrl(imagePath)) {
            const markdownAnyPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(imagePath)}[^)]*\\)`, 'g');
            updatedContent = updatedContent.replace(markdownAnyPattern, `![[${imagePath}]]`);
          }

          // Replace any existing Obsidian syntax that doesn't match our expected format
          const obsidianPattern = new RegExp(`!\\[\\[[^\\]]*\\]\\]`, 'g');
          // Only replace if it's not already in the correct format and not a URL
          if (!isUrl(imagePath)) {
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
   * @param {Array} [options.files=[]] - Array of additional files to save (for multi-file conversions)
   * @param {string} options.name - Base name for the output file/directory
   * @param {string} options.type - Type of content (e.g., 'pdf', 'url', etc.)
   * @param {string} [options.outputDir] - Custom output directory
   * @param {Object} [options.options={}] - Additional options
   * @returns {Promise<Object>} Result of the save operation
   */
  async saveConversionResult({
    content,
    metadata = {},
    images = [],
    files = [],
    name,
    type,
    fileType,
    outputDir,
    options = {}
  }) {
    console.log(`🔄 [ConversionResultManager] Saving conversion result for ${name} (${type || fileType})`);

    // Validate required parameters
    if (!content) {
      console.error('❌ [ConversionResultManager] No content provided!');
      throw new Error('Content is required for conversion result');
    }
    if (!name) {
      console.error('❌ [ConversionResultManager] No name provided!');
      throw new Error('Name is required for conversion result');
    }
    if (!type && !fileType) {
      console.error('❌ [ConversionResultManager] No type or fileType provided!');
      throw new Error('Type or fileType is required for conversion result');
    }

    // Use fileType as fallback for type if type is not provided
    const contentType = type || fileType;
    if (!outputDir) {
      console.error('❌ [ConversionResultManager] No output directory provided!');
      console.log('⚠️ [ConversionResultManager] Using default output directory:', this.defaultOutputDir);
    }

    // Use provided output directory or fall back to default
    const baseOutputDir = outputDir || this.defaultOutputDir;

    // Determine if we should create a subdirectory
    const userProvidedOutputDir = !!outputDir;
    const createSubdirectory = userProvidedOutputDir ? false : options.createSubdirectory !== undefined ? options.createSubdirectory : true;

    // Generate appropriate filename based on type and metadata
    const filename = generateAppropriateFilename(name, contentType, metadata);

    // Determine URL status for path validation
    const isUrl = contentType === 'url' || contentType === 'parenturl';

    // Get the base name without extension and ensure it's valid for the file system
    const baseName = getBasename(filename).replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    const outputBasePath = createSubdirectory ? path.join(baseOutputDir, `${baseName}_${Date.now()}`) : baseOutputDir;
    console.log(`📁 [ConversionResultManager] Generated output path: ${outputBasePath}`);

    // Create output directory with URL awareness
    try {
      await this.fileSystem.createDirectory(outputBasePath, {
        isUrl
      });
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
        await this.fileSystem.createDirectory(fullDirPath, {
          isUrl
        });

        // Save images to their respective directories
        for (const image of dirImages) {
          if (image && image.data) {
            try {
              const imagePath = path.join(outputBasePath, image.path);
              console.log(`💾 Saving image: ${imagePath}`);

              // Ensure the image data is in the right format
              const imageData = Buffer.isBuffer(image.data) ? image.data : typeof image.data === 'string' && image.data.startsWith('data:') ? Buffer.from(image.data.split(',')[1], 'base64') : Buffer.from(image.data, 'base64');
              await this.fileSystem.writeFile(imagePath, imageData, null, {
                isUrl
              });
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
    const mainFilePath = createSubdirectory ? path.join(outputBasePath, 'document.md') : path.join(outputBasePath, `${baseName}.md`);

    // Update image references to use Obsidian format
    const updatedContent = this.updateImageReferences(content, images);

    // Clean metadata fields and create metadata object
    const fullMetadata = cleanMetadata({
      type: contentType,
      fileType: fileType || type,
      // Ensure fileType is included in metadata
      converted: new Date().toISOString(),
      ...metadata
    });

    // Extract and merge frontmatter if it exists
    const {
      metadata: existingMetadata,
      content: contentWithoutFrontmatter
    } = extractFrontmatter(updatedContent);
    console.log('📝 Extracted existing frontmatter:', existingMetadata);

    // Merge metadata using shared utility
    const mergedMetadata = mergeMetadata(existingMetadata, fullMetadata, {
      type: fullMetadata.type,
      // Ensure type from fullMetadata takes precedence
      converted: new Date().toISOString() // Always use current timestamp
    });

    // Format and combine with content
    const frontmatter = formatMetadata(mergedMetadata);
    const fullContent = frontmatter + contentWithoutFrontmatter;

    // Save the markdown content with URL awareness
    await this.fileSystem.writeFile(mainFilePath, fullContent, 'utf8', {
      isUrl
    });

    // Handle additional files if provided (for multi-file conversions like parenturl)
    if (files && Array.isArray(files) && files.length > 0) {
      console.log(`📄 [ConversionResultManager] Processing ${files.length} additional files`);
      for (const file of files) {
        if (!file || !file.name || !file.content) {
          console.warn(`⚠️ Invalid file object:`, file);
          continue;
        }
        try {
          // Ensure the directory exists
          const fileDirPath = path.dirname(path.join(outputBasePath, file.name));
          await this.fileSystem.createDirectory(fileDirPath, {
            isUrl
          });

          // Save the file
          const filePath = path.join(outputBasePath, file.name);
          console.log(`💾 Saving additional file: ${filePath}`);

          // Determine if we need to add frontmatter
          let fileContent = file.content;
          if (file.type === 'text' && !fileContent.trim().startsWith('---')) {
            // Create metadata for this file
            const fileMetadata = cleanMetadata({
              type: file.type || 'text',
              converted: new Date().toISOString(),
              ...(file.metadata || {})
            });

            // Add frontmatter
            const fileFrontmatter = formatMetadata(fileMetadata);
            fileContent = fileFrontmatter + fileContent;
          }
          await this.fileSystem.writeFile(filePath, fileContent, 'utf8', {
            isUrl
          });
        } catch (fileError) {
          console.error(`❌ Failed to save file: ${file.name}`, fileError);
        }
      }
    }

    // Log the result details
    console.log('💾 Conversion result saved:', {
      outputPath: outputBasePath,
      mainFile: mainFilePath,
      hasImages: images && images.length > 0,
      imageCount: images ? images.length : 0,
      additionalFiles: files ? files.length : 0,
      contentLength: fullContent.length
    });

    // Special handling for data files (CSV, XLSX)
    const isDataFile = contentType === 'csv' || contentType === 'xlsx' || fileType === 'csv' || fileType === 'xlsx';
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
      type: contentType,
      fileType: fileType || type,
      outputPath: outputBasePath,
      mainFile: mainFilePath
    });
    return result;
  }
}
module.exports = new ConversionResultManager();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsImluc3RhbmNlIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJleHRyYWN0RnJvbnRtYXR0ZXIiLCJtZXJnZU1ldGFkYXRhIiwiY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSIsImdldEJhc2VuYW1lIiwiZ2VuZXJhdGVVcmxGaWxlbmFtZSIsImdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZSIsIm9yaWdpbmFsTmFtZSIsInR5cGUiLCJtZXRhZGF0YSIsInNvdXJjZV91cmwiLCJlc2NhcGVSZWdFeHAiLCJzdHJpbmciLCJ1bmRlZmluZWQiLCJjb25zb2xlIiwid2FybiIsInJlcGxhY2UiLCJlcnJvciIsImlzVXJsIiwic3RhcnRzV2l0aCIsIkNvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwiZGVmYXVsdE91dHB1dERpciIsImpvaW4iLCJnZXRQYXRoIiwibG9nIiwidXBkYXRlSW1hZ2VSZWZlcmVuY2VzIiwiY29udGVudCIsImltYWdlcyIsIkFycmF5IiwiaXNBcnJheSIsImxlbmd0aCIsInVwZGF0ZWRDb250ZW50IiwiZ2VuZXJpY01hcmtkb3duUGF0dGVybiIsInByb2Nlc3NlZEltYWdlSWRzIiwiU2V0IiwiaW1hZ2VQYXRocyIsIk1hcCIsImZvckVhY2giLCJpbWFnZSIsImltYWdlUGF0aCIsIm5hbWUiLCJzcmMiLCJzZXQiLCJiYXNlbmFtZSIsIm1hdGNoIiwiYWx0IiwiaW1hZ2VJZCIsImhhcyIsImdldCIsImFkZCIsIm1hcmtkb3duUGF0dGVybiIsIlJlZ0V4cCIsIm1hcmtkb3duQW55UGF0dGVybiIsIm9ic2lkaWFuUGF0dGVybiIsImNvcnJlY3RPYnNpZGlhbkZvcm1hdCIsImluY2x1ZGVzIiwibWF0Y2hlcyIsIm1hdGNoUGF0aCIsInN1YnN0cmluZyIsImV4dG5hbWUiLCJpbWFnZUVycm9yIiwiZXh0cmFjdGVkSW1hZ2VzUGF0dGVybiIsInNhdmVDb252ZXJzaW9uUmVzdWx0IiwiZmlsZXMiLCJmaWxlVHlwZSIsIm91dHB1dERpciIsIm9wdGlvbnMiLCJFcnJvciIsImNvbnRlbnRUeXBlIiwiYmFzZU91dHB1dERpciIsInVzZXJQcm92aWRlZE91dHB1dERpciIsImNyZWF0ZVN1YmRpcmVjdG9yeSIsImZpbGVuYW1lIiwiYmFzZU5hbWUiLCJvdXRwdXRCYXNlUGF0aCIsIkRhdGUiLCJub3ciLCJjcmVhdGVEaXJlY3RvcnkiLCJtZXNzYWdlIiwiaW1hZ2VzQnlEaXIiLCJkaXJQYXRoIiwiZGlybmFtZSIsInB1c2giLCJkaXJJbWFnZXMiLCJlbnRyaWVzIiwiZnVsbERpclBhdGgiLCJkYXRhIiwiaW1hZ2VEYXRhIiwiQnVmZmVyIiwiaXNCdWZmZXIiLCJmcm9tIiwic3BsaXQiLCJ3cml0ZUZpbGUiLCJtYWluRmlsZVBhdGgiLCJmdWxsTWV0YWRhdGEiLCJjb252ZXJ0ZWQiLCJ0b0lTT1N0cmluZyIsImV4aXN0aW5nTWV0YWRhdGEiLCJjb250ZW50V2l0aG91dEZyb250bWF0dGVyIiwibWVyZ2VkTWV0YWRhdGEiLCJmcm9udG1hdHRlciIsImZ1bGxDb250ZW50IiwiZmlsZSIsImZpbGVEaXJQYXRoIiwiZmlsZVBhdGgiLCJmaWxlQ29udGVudCIsInRyaW0iLCJmaWxlTWV0YWRhdGEiLCJmaWxlRnJvbnRtYXR0ZXIiLCJmaWxlRXJyb3IiLCJvdXRwdXRQYXRoIiwibWFpbkZpbGUiLCJoYXNJbWFnZXMiLCJpbWFnZUNvdW50IiwiYWRkaXRpb25hbEZpbGVzIiwiY29udGVudExlbmd0aCIsImlzRGF0YUZpbGUiLCJmb3JtYXQiLCJyZXN1bHQiLCJzdWNjZXNzIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9Db252ZXJzaW9uUmVzdWx0TWFuYWdlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogQ29udmVyc2lvblJlc3VsdE1hbmFnZXIuanNcclxuICogXHJcbiAqIEhhbmRsZXMgc2F2aW5nIGNvbnZlcnNpb24gcmVzdWx0cyB0byBkaXNrIHdpdGggY29uc2lzdGVudCBmaWxlIGhhbmRsaW5nLlxyXG4gKiBNYW5hZ2VzIG91dHB1dCBkaXJlY3Rvcnkgc3RydWN0dXJlLCBpbWFnZSBzYXZpbmcsIGFuZCBtZXRhZGF0YSBmb3JtYXR0aW5nLlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRWxlY3Ryb25Db252ZXJzaW9uU2VydmljZS5qczogVXNlcyB0aGlzIHNlcnZpY2UgZm9yIHNhdmluZyBjb252ZXJzaW9uIHJlc3VsdHNcclxuICogLSBzcmMvZWxlY3Ryb24vc2VydmljZXMvRmlsZVN5c3RlbVNlcnZpY2UuanM6IFVzZWQgZm9yIGZpbGUgc3lzdGVtIG9wZXJhdGlvbnNcclxuICogLSBzcmMvZWxlY3Ryb24vYWRhcHRlcnMvbWV0YWRhdGFFeHRyYWN0b3JBZGFwdGVyLmpzOiBVc2VkIGZvciBtZXRhZGF0YSBmb3JtYXR0aW5nXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgeyBhcHAgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbmNvbnN0IHsgaW5zdGFuY2U6IEZpbGVTeXN0ZW1TZXJ2aWNlIH0gPSByZXF1aXJlKCcuL0ZpbGVTeXN0ZW1TZXJ2aWNlJyk7IC8vIEltcG9ydCBpbnN0YW5jZVxyXG5jb25zdCB7IGZvcm1hdE1ldGFkYXRhLCBjbGVhbk1ldGFkYXRhLCBleHRyYWN0RnJvbnRtYXR0ZXIsIG1lcmdlTWV0YWRhdGEgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL21hcmtkb3duJyk7XHJcbmNvbnN0IHsgY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSwgZ2V0QmFzZW5hbWUsIGdlbmVyYXRlVXJsRmlsZW5hbWUgfSA9IHJlcXVpcmUoJy4uL3V0aWxzL2ZpbGVzJyk7XHJcblxyXG4vKipcclxuICogR2VuZXJhdGUgYXBwcm9wcmlhdGUgZmlsZW5hbWUgYmFzZWQgb24gY29udmVyc2lvbiB0eXBlIGFuZCBtZXRhZGF0YVxyXG4gKiBAcHJpdmF0ZVxyXG4gKiBAcGFyYW0ge3N0cmluZ30gb3JpZ2luYWxOYW1lIC0gT3JpZ2luYWwgZmlsZW5hbWUgb3IgVVJMXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSB0eXBlIC0gVHlwZSBvZiBjb252ZXJzaW9uIChlLmcuLCAndXJsJywgJ3BkZicpXHJcbiAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIE1ldGFkYXRhIGZyb20gY29udmVyc2lvblxyXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgYXBwcm9wcmlhdGUgZmlsZW5hbWVcclxuICovXHJcbmZ1bmN0aW9uIGdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZShvcmlnaW5hbE5hbWUsIHR5cGUsIG1ldGFkYXRhID0ge30pIHtcclxuICBpZiAodHlwZSA9PT0gJ3VybCcgJiYgbWV0YWRhdGEuc291cmNlX3VybCkge1xyXG4gICAgcmV0dXJuIGdlbmVyYXRlVXJsRmlsZW5hbWUobWV0YWRhdGEuc291cmNlX3VybCk7XHJcbiAgfVxyXG4gIFxyXG4gIC8vIEZvciByZWd1bGFyIGZpbGVzLCBjbGVhbiB0aGUgb3JpZ2luYWwgbmFtZVxyXG4gIHJldHVybiBjbGVhblRlbXBvcmFyeUZpbGVuYW1lKG9yaWdpbmFsTmFtZSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIZWxwZXIgZnVuY3Rpb24gdG8gZXNjYXBlIHNwZWNpYWwgY2hhcmFjdGVycyBpbiByZWd1bGFyIGV4cHJlc3Npb25zXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmcgLSBUaGUgc3RyaW5nIHRvIGVzY2FwZVxyXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgZXNjYXBlZCBzdHJpbmdcclxuICovXHJcbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cChzdHJpbmcpIHtcclxuICAvLyBIYW5kbGUgbnVsbCwgdW5kZWZpbmVkLCBvciBub24tc3RyaW5nIGlucHV0c1xyXG4gIGlmIChzdHJpbmcgPT09IG51bGwgfHwgc3RyaW5nID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHtcclxuICAgIGNvbnNvbGUud2Fybihg4pqg77iPIEludmFsaWQgaW5wdXQgdG8gZXNjYXBlUmVnRXhwOiAke3N0cmluZ31gKTtcclxuICAgIHJldHVybiAnJztcclxuICB9XHJcbiAgXHJcbiAgdHJ5IHtcclxuICAgIHJldHVybiBzdHJpbmcucmVwbGFjZSgvWy4qKz9eJHt9KCl8W1xcXVxcXFxdL2csICdcXFxcJCYnKTtcclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgY29uc29sZS5lcnJvcihg4p2MIEVycm9yIGluIGVzY2FwZVJlZ0V4cDpgLCBlcnJvcik7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGNoZWNrIGlmIGEgcGF0aCBpcyBhIFVSTFxyXG4gKiBAcGFyYW0ge3N0cmluZ30gcGF0aCAtIFRoZSBwYXRoIHRvIGNoZWNrXHJcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBwYXRoIGlzIGEgVVJMXHJcbiAqL1xyXG5mdW5jdGlvbiBpc1VybChwYXRoKSB7XHJcbiAgcmV0dXJuIHR5cGVvZiBwYXRoID09PSAnc3RyaW5nJyAmJiAocGF0aC5zdGFydHNXaXRoKCdodHRwOi8vJykgfHwgcGF0aC5zdGFydHNXaXRoKCdodHRwczovLycpKTtcclxufVxyXG5cclxuY2xhc3MgQ29udmVyc2lvblJlc3VsdE1hbmFnZXIge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5maWxlU3lzdGVtID0gRmlsZVN5c3RlbVNlcnZpY2U7XHJcbiAgICB0aGlzLmRlZmF1bHRPdXRwdXREaXIgPSBwYXRoLmpvaW4oYXBwLmdldFBhdGgoJ3VzZXJEYXRhJyksICdjb252ZXJzaW9ucycpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygnQ29udmVyc2lvblJlc3VsdE1hbmFnZXIgaW5pdGlhbGl6ZWQgd2l0aCBkZWZhdWx0IG91dHB1dCBkaXJlY3Rvcnk6JywgdGhpcy5kZWZhdWx0T3V0cHV0RGlyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFVwZGF0ZSBpbWFnZSByZWZlcmVuY2VzIHRvIHVzZSBPYnNpZGlhbiBmb3JtYXRcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZW50IC0gVGhlIGNvbnRlbnQgdG8gdXBkYXRlXHJcbiAgICogQHBhcmFtIHtBcnJheX0gaW1hZ2VzIC0gQXJyYXkgb2YgaW1hZ2Ugb2JqZWN0c1xyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IFVwZGF0ZWQgY29udGVudCB3aXRoIE9ic2lkaWFuIGltYWdlIHJlZmVyZW5jZXNcclxuICAgKi9cclxuICB1cGRhdGVJbWFnZVJlZmVyZW5jZXMoY29udGVudCwgaW1hZ2VzKSB7XHJcbiAgICAvLyBWYWxpZGF0ZSBpbnB1dHNcclxuICAgIGlmICghY29udGVudCB8fCB0eXBlb2YgY29udGVudCAhPT0gJ3N0cmluZycpIHtcclxuICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gSW52YWxpZCBjb250ZW50IHByb3ZpZGVkIHRvIHVwZGF0ZUltYWdlUmVmZXJlbmNlcycpO1xyXG4gICAgICByZXR1cm4gY29udGVudCB8fCAnJztcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFpbWFnZXMgfHwgIUFycmF5LmlzQXJyYXkoaW1hZ2VzKSB8fCBpbWFnZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBsZXQgdXBkYXRlZENvbnRlbnQgPSBjb250ZW50O1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBGaXJzdCwgaGFuZGxlIGFueSBnZW5lcmljIHN0YW5kYXJkIE1hcmtkb3duIGltYWdlIGxpbmtzIHRoYXQgbWlnaHQgbm90IGJlIGFzc29jaWF0ZWQgd2l0aCBvdXIgaW1hZ2VzXHJcbiAgICAgIC8vIFRoaXMgaXMgZXNwZWNpYWxseSBpbXBvcnRhbnQgZm9yIE1pc3RyYWwgT0NSIHJlc3VsdHNcclxuICAgICAgY29uc3QgZ2VuZXJpY01hcmtkb3duUGF0dGVybiA9IC8hXFxbKC4qPylcXF1cXCgoLio/KVxcKS9nO1xyXG4gICAgICBjb25zdCBwcm9jZXNzZWRJbWFnZUlkcyA9IG5ldyBTZXQoKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBhIG1hcCBvZiBpbWFnZSBwYXRocyBmb3IgcXVpY2sgbG9va3VwXHJcbiAgICAgIGNvbnN0IGltYWdlUGF0aHMgPSBuZXcgTWFwKCk7XHJcbiAgICAgIGltYWdlcy5mb3JFYWNoKGltYWdlID0+IHtcclxuICAgICAgICBpZiAoaW1hZ2UgJiYgdHlwZW9mIGltYWdlID09PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gaW1hZ2UucGF0aCB8fCBpbWFnZS5uYW1lIHx8IChpbWFnZS5zcmMgPyBpbWFnZS5zcmMgOiBudWxsKTtcclxuICAgICAgICAgIGlmIChpbWFnZVBhdGgpIHtcclxuICAgICAgICAgICAgLy8gU3RvcmUgYm90aCB0aGUgZnVsbCBwYXRoIGFuZCB0aGUgYmFzZW5hbWUgZm9yIG1hdGNoaW5nXHJcbiAgICAgICAgICAgIGltYWdlUGF0aHMuc2V0KGltYWdlUGF0aCwgaW1hZ2VQYXRoKTtcclxuICAgICAgICAgICAgaW1hZ2VQYXRocy5zZXQocGF0aC5iYXNlbmFtZShpbWFnZVBhdGgpLCBpbWFnZVBhdGgpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBSZXBsYWNlIGdlbmVyaWMgTWFya2Rvd24gaW1hZ2UgbGlua3Mgd2l0aCBPYnNpZGlhbiBmb3JtYXQgaWYgd2UgaGF2ZSBhIG1hdGNoaW5nIGltYWdlXHJcbiAgICAgIC8vIEJ1dCBwcmVzZXJ2ZSBVUkwgaW1hZ2VzIGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UoZ2VuZXJpY01hcmtkb3duUGF0dGVybiwgKG1hdGNoLCBhbHQsIHNyYykgPT4ge1xyXG4gICAgICAgIC8vIElmIGl0J3MgYSBVUkwsIGtlZXAgaXQgaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgICAgaWYgKGlzVXJsKHNyYykpIHtcclxuICAgICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRXh0cmFjdCB0aGUgaW1hZ2UgSUQgZnJvbSB0aGUgc3JjXHJcbiAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHBhdGguYmFzZW5hbWUoc3JjKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBJZiB3ZSBoYXZlIGEgbWF0Y2hpbmcgaW1hZ2UsIHVzZSB0aGUgT2JzaWRpYW4gZm9ybWF0XHJcbiAgICAgICAgaWYgKGltYWdlUGF0aHMuaGFzKGltYWdlSWQpIHx8IGltYWdlUGF0aHMuaGFzKHNyYykpIHtcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlUGF0aHMuZ2V0KGltYWdlSWQpIHx8IGltYWdlUGF0aHMuZ2V0KHNyYyk7XHJcbiAgICAgICAgICBwcm9jZXNzZWRJbWFnZUlkcy5hZGQoaW1hZ2VJZCk7XHJcbiAgICAgICAgICByZXR1cm4gYCFbWyR7aW1hZ2VQYXRofV1dYDtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gT3RoZXJ3aXNlLCBrZWVwIHRoZSBvcmlnaW5hbCByZWZlcmVuY2VcclxuICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gTm93IHByb2Nlc3MgZWFjaCBpbWFnZSBzcGVjaWZpY2FsbHlcclxuICAgICAgaW1hZ2VzLmZvckVhY2goaW1hZ2UgPT4ge1xyXG4gICAgICAgIC8vIFNraXAgaW52YWxpZCBpbWFnZSBvYmplY3RzXHJcbiAgICAgICAgaWYgKCFpbWFnZSB8fCB0eXBlb2YgaW1hZ2UgIT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBJbnZhbGlkIGltYWdlIG9iamVjdCBpbiB1cGRhdGVJbWFnZVJlZmVyZW5jZXM6JywgaW1hZ2UpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRGV0ZXJtaW5lIHRoZSBpbWFnZSBwYXRoIHRvIHVzZVxyXG4gICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gaW1hZ2UucGF0aCB8fCBpbWFnZS5uYW1lIHx8IChpbWFnZS5zcmMgPyBpbWFnZS5zcmMgOiBudWxsKTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgaWYgKCFpbWFnZVBhdGgpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gSW1hZ2Ugb2JqZWN0IGhhcyBubyBwYXRoLCBuYW1lLCBvciBzcmM6JywgaW1hZ2UpO1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFNraXAgaWYgd2UgYWxyZWFkeSBwcm9jZXNzZWQgdGhpcyBpbWFnZSBpbiB0aGUgZ2VuZXJpYyBwYXNzXHJcbiAgICAgICAgICBjb25zdCBpbWFnZUlkID0gcGF0aC5iYXNlbmFtZShpbWFnZVBhdGgpO1xyXG4gICAgICAgICAgaWYgKHByb2Nlc3NlZEltYWdlSWRzLmhhcyhpbWFnZUlkKSkge1xyXG4gICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIEZpcnN0IHJlcGxhY2Ugc3RhbmRhcmQgbWFya2Rvd24gaW1hZ2Ugc3ludGF4XHJcbiAgICAgICAgICBpZiAoaW1hZ2Uuc3JjKSB7XHJcbiAgICAgICAgICAgIC8vIFNraXAgVVJMIGltYWdlcyAtIGtlZXAgdGhlbSBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgICAgICAgaWYgKCFpc1VybChpbWFnZS5zcmMpKSB7XHJcbiAgICAgICAgICAgICAgY29uc3QgbWFya2Rvd25QYXR0ZXJuID0gbmV3IFJlZ0V4cChgIVxcXFxbW15cXFxcXV0qXFxcXF1cXFxcKCR7ZXNjYXBlUmVnRXhwKGltYWdlLnNyYyl9W14pXSpcXFxcKWAsICdnJyk7XHJcbiAgICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKG1hcmtkb3duUGF0dGVybiwgYCFbWyR7aW1hZ2VQYXRofV1dYCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gUmVwbGFjZSBzdGFuZGFyZCBtYXJrZG93biBpbWFnZSBzeW50YXggd2l0aCBhbnkgcGF0aFxyXG4gICAgICAgICAgLy8gU2tpcCBVUkwgaW1hZ2VzIC0ga2VlcCB0aGVtIGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICAgICAgaWYgKCFpc1VybChpbWFnZVBhdGgpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duQW55UGF0dGVybiA9IG5ldyBSZWdFeHAoYCFcXFxcW1teXFxcXF1dKlxcXFxdXFxcXCgke2VzY2FwZVJlZ0V4cChpbWFnZVBhdGgpfVteKV0qXFxcXClgLCAnZycpO1xyXG4gICAgICAgICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UobWFya2Rvd25BbnlQYXR0ZXJuLCBgIVtbJHtpbWFnZVBhdGh9XV1gKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gUmVwbGFjZSBhbnkgZXhpc3RpbmcgT2JzaWRpYW4gc3ludGF4IHRoYXQgZG9lc24ndCBtYXRjaCBvdXIgZXhwZWN0ZWQgZm9ybWF0XHJcbiAgICAgICAgICBjb25zdCBvYnNpZGlhblBhdHRlcm4gPSBuZXcgUmVnRXhwKGAhXFxcXFtcXFxcW1teXFxcXF1dKlxcXFxdXFxcXF1gLCAnZycpO1xyXG4gICAgICAgICAgLy8gT25seSByZXBsYWNlIGlmIGl0J3Mgbm90IGFscmVhZHkgaW4gdGhlIGNvcnJlY3QgZm9ybWF0IGFuZCBub3QgYSBVUkxcclxuICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2VQYXRoKSkge1xyXG4gICAgICAgICAgICBjb25zdCBjb3JyZWN0T2JzaWRpYW5Gb3JtYXQgPSBgIVtbJHtpbWFnZVBhdGh9XV1gO1xyXG4gICAgICAgICAgICBpZiAoIXVwZGF0ZWRDb250ZW50LmluY2x1ZGVzKGNvcnJlY3RPYnNpZGlhbkZvcm1hdCkpIHtcclxuICAgICAgICAgICAgICAvLyBGaW5kIGFsbCBPYnNpZGlhbiBpbWFnZSByZWZlcmVuY2VzXHJcbiAgICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IHVwZGF0ZWRDb250ZW50Lm1hdGNoKG9ic2lkaWFuUGF0dGVybik7XHJcbiAgICAgICAgICAgICAgaWYgKG1hdGNoZXMpIHtcclxuICAgICAgICAgICAgICAgIC8vIFJlcGxhY2Ugb25seSB0aG9zZSB0aGF0IGNvbnRhaW4gcGFydHMgb2Ygb3VyIGltYWdlIHBhdGhcclxuICAgICAgICAgICAgICAgIG1hdGNoZXMuZm9yRWFjaChtYXRjaCA9PiB7XHJcbiAgICAgICAgICAgICAgICAgIC8vIEV4dHJhY3QgdGhlIHBhdGggZnJvbSB0aGUgbWF0Y2hcclxuICAgICAgICAgICAgICAgICAgY29uc3QgbWF0Y2hQYXRoID0gbWF0Y2guc3Vic3RyaW5nKDMsIG1hdGNoLmxlbmd0aCAtIDIpO1xyXG4gICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgLy8gQ2hlY2sgaWYgdGhpcyBtYXRjaCBpcyByZWxhdGVkIHRvIG91ciBpbWFnZVxyXG4gICAgICAgICAgICAgICAgICBpZiAobWF0Y2hQYXRoLmluY2x1ZGVzKHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoLCBwYXRoLmV4dG5hbWUoaW1hZ2VQYXRoKSkpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKG1hdGNoLCBjb3JyZWN0T2JzaWRpYW5Gb3JtYXQpO1xyXG4gICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChpbWFnZUVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBFcnJvciBwcm9jZXNzaW5nIGltYWdlIHJlZmVyZW5jZTpgLCBpbWFnZUVycm9yKTtcclxuICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggbmV4dCBpbWFnZVxyXG4gICAgICAgIH1cclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBGaW5hbGx5LCByZW1vdmUgYW55IFwiRXh0cmFjdGVkIEltYWdlc1wiIHNlY3Rpb24gdGhhdCBtaWdodCBoYXZlIGJlZW4gYWRkZWRcclxuICAgICAgY29uc3QgZXh0cmFjdGVkSW1hZ2VzUGF0dGVybiA9IC9cXG5cXG4jIyBFeHRyYWN0ZWQgSW1hZ2VzXFxuXFxuKD86IVxcW1xcW1teXFxdXStcXF1cXF1cXG5cXG4pKi9nO1xyXG4gICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UoZXh0cmFjdGVkSW1hZ2VzUGF0dGVybiwgJycpO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiB1cGRhdGVJbWFnZVJlZmVyZW5jZXM6JywgZXJyb3IpO1xyXG4gICAgICAvLyBSZXR1cm4gb3JpZ2luYWwgY29udGVudCBvbiBlcnJvclxyXG4gICAgICByZXR1cm4gY29udGVudDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdXBkYXRlZENvbnRlbnQ7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTYXZlcyBjb252ZXJzaW9uIHJlc3VsdCB0byBkaXNrIHdpdGggY29uc2lzdGVudCBmaWxlIGhhbmRsaW5nXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBPcHRpb25zIGZvciBzYXZpbmcgdGhlIGNvbnZlcnNpb24gcmVzdWx0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMuY29udGVudCAtIFRoZSBjb250ZW50IHRvIHNhdmVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnMubWV0YWRhdGE9e31dIC0gTWV0YWRhdGEgdG8gaW5jbHVkZSBpbiB0aGUgZnJvbnRtYXR0ZXJcclxuICAgKiBAcGFyYW0ge0FycmF5fSBbb3B0aW9ucy5pbWFnZXM9W11dIC0gQXJyYXkgb2YgaW1hZ2Ugb2JqZWN0cyB0byBzYXZlXHJcbiAgICogQHBhcmFtIHtBcnJheX0gW29wdGlvbnMuZmlsZXM9W11dIC0gQXJyYXkgb2YgYWRkaXRpb25hbCBmaWxlcyB0byBzYXZlIChmb3IgbXVsdGktZmlsZSBjb252ZXJzaW9ucylcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy5uYW1lIC0gQmFzZSBuYW1lIGZvciB0aGUgb3V0cHV0IGZpbGUvZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMudHlwZSAtIFR5cGUgb2YgY29udGVudCAoZS5nLiwgJ3BkZicsICd1cmwnLCBldGMuKVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5vdXRwdXREaXJdIC0gQ3VzdG9tIG91dHB1dCBkaXJlY3RvcnlcclxuICAgKiBAcGFyYW0ge09iamVjdH0gW29wdGlvbnMub3B0aW9ucz17fV0gLSBBZGRpdGlvbmFsIG9wdGlvbnNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBSZXN1bHQgb2YgdGhlIHNhdmUgb3BlcmF0aW9uXHJcbiAgICovXHJcbiAgYXN5bmMgc2F2ZUNvbnZlcnNpb25SZXN1bHQoeyBjb250ZW50LCBtZXRhZGF0YSA9IHt9LCBpbWFnZXMgPSBbXSwgZmlsZXMgPSBbXSwgbmFtZSwgdHlwZSwgZmlsZVR5cGUsIG91dHB1dERpciwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgIGNvbnNvbGUubG9nKGDwn5SEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gU2F2aW5nIGNvbnZlcnNpb24gcmVzdWx0IGZvciAke25hbWV9ICgke3R5cGUgfHwgZmlsZVR5cGV9KWApO1xyXG4gICAgXHJcbiAgICAvLyBWYWxpZGF0ZSByZXF1aXJlZCBwYXJhbWV0ZXJzXHJcbiAgICBpZiAoIWNvbnRlbnQpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gY29udGVudCBwcm92aWRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb250ZW50IGlzIHJlcXVpcmVkIGZvciBjb252ZXJzaW9uIHJlc3VsdCcpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIW5hbWUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gbmFtZSBwcm92aWRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdOYW1lIGlzIHJlcXVpcmVkIGZvciBjb252ZXJzaW9uIHJlc3VsdCcpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIXR5cGUgJiYgIWZpbGVUeXBlKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIHR5cGUgb3IgZmlsZVR5cGUgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignVHlwZSBvciBmaWxlVHlwZSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXNlIGZpbGVUeXBlIGFzIGZhbGxiYWNrIGZvciB0eXBlIGlmIHR5cGUgaXMgbm90IHByb3ZpZGVkXHJcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IHR5cGUgfHwgZmlsZVR5cGU7XHJcbiAgICBcclxuICAgIGlmICghb3V0cHV0RGlyKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG91dHB1dCBkaXJlY3RvcnkgcHJvdmlkZWQhJyk7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfimqDvuI8gW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBVc2luZyBkZWZhdWx0IG91dHB1dCBkaXJlY3Rvcnk6JywgdGhpcy5kZWZhdWx0T3V0cHV0RGlyKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gVXNlIHByb3ZpZGVkIG91dHB1dCBkaXJlY3Rvcnkgb3IgZmFsbCBiYWNrIHRvIGRlZmF1bHRcclxuICAgIGNvbnN0IGJhc2VPdXRwdXREaXIgPSBvdXRwdXREaXIgfHwgdGhpcy5kZWZhdWx0T3V0cHV0RGlyO1xyXG4gICAgXHJcbiAgICAvLyBEZXRlcm1pbmUgaWYgd2Ugc2hvdWxkIGNyZWF0ZSBhIHN1YmRpcmVjdG9yeVxyXG4gICAgY29uc3QgdXNlclByb3ZpZGVkT3V0cHV0RGlyID0gISFvdXRwdXREaXI7XHJcbiAgICBjb25zdCBjcmVhdGVTdWJkaXJlY3RvcnkgPSB1c2VyUHJvdmlkZWRPdXRwdXREaXIgPyBmYWxzZSA6IFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgIChvcHRpb25zLmNyZWF0ZVN1YmRpcmVjdG9yeSAhPT0gdW5kZWZpbmVkID8gb3B0aW9ucy5jcmVhdGVTdWJkaXJlY3RvcnkgOiB0cnVlKTtcclxuICAgXHJcbiAgIC8vIEdlbmVyYXRlIGFwcHJvcHJpYXRlIGZpbGVuYW1lIGJhc2VkIG9uIHR5cGUgYW5kIG1ldGFkYXRhXHJcbiAgIGNvbnN0IGZpbGVuYW1lID0gZ2VuZXJhdGVBcHByb3ByaWF0ZUZpbGVuYW1lKG5hbWUsIGNvbnRlbnRUeXBlLCBtZXRhZGF0YSk7XHJcbiAgIFxyXG4gICAvLyBEZXRlcm1pbmUgVVJMIHN0YXR1cyBmb3IgcGF0aCB2YWxpZGF0aW9uXHJcbiAgIGNvbnN0IGlzVXJsID0gY29udGVudFR5cGUgPT09ICd1cmwnIHx8IGNvbnRlbnRUeXBlID09PSAncGFyZW50dXJsJztcclxuXHJcbiAgICAvLyBHZXQgdGhlIGJhc2UgbmFtZSB3aXRob3V0IGV4dGVuc2lvbiBhbmQgZW5zdXJlIGl0J3MgdmFsaWQgZm9yIHRoZSBmaWxlIHN5c3RlbVxyXG4gICAgY29uc3QgYmFzZU5hbWUgPSBnZXRCYXNlbmFtZShmaWxlbmFtZSkucmVwbGFjZSgvWzw+OlwiL1xcXFx8PypdKy9nLCAnXycpLnJlcGxhY2UoL1xccysvZywgJ18nKTtcclxuICAgIGNvbnN0IG91dHB1dEJhc2VQYXRoID0gY3JlYXRlU3ViZGlyZWN0b3J5ID8gXHJcbiAgICAgIHBhdGguam9pbihiYXNlT3V0cHV0RGlyLCBgJHtiYXNlTmFtZX1fJHtEYXRlLm5vdygpfWApIDogXHJcbiAgICAgIGJhc2VPdXRwdXREaXI7XHJcblxyXG4gICAgY29uc29sZS5sb2coYPCfk4EgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0ZWQgb3V0cHV0IHBhdGg6ICR7b3V0cHV0QmFzZVBhdGh9YCk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIG91dHB1dCBkaXJlY3Rvcnkgd2l0aCBVUkwgYXdhcmVuZXNzXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KG91dHB1dEJhc2VQYXRoLCB7IGlzVXJsIH0pO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gQ3JlYXRlZCBvdXRwdXQgZGlyZWN0b3J5OiAke291dHB1dEJhc2VQYXRofWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gRmFpbGVkIHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIGltYWdlcyBkaXJlY3RvcnkgaWYgd2UgaGF2ZSBpbWFnZXNcclxuICAgIGlmIChpbWFnZXMgJiYgaW1hZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gR3JvdXAgaW1hZ2VzIGJ5IHRoZWlyIGRpcmVjdG9yeSBwYXRoc1xyXG4gICAgICBjb25zdCBpbWFnZXNCeURpciA9IG5ldyBNYXAoKTtcclxuICAgICAgXHJcbiAgICAgIGZvciAoY29uc3QgaW1hZ2Ugb2YgaW1hZ2VzKSB7XHJcbiAgICAgICAgaWYgKCFpbWFnZSB8fCAhaW1hZ2UucGF0aCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3Qgb3IgbWlzc2luZyBwYXRoOmAsIGltYWdlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBFeHRyYWN0IHRoZSBkaXJlY3RvcnkgcGFydCBmcm9tIHRoZSBpbWFnZSBwYXRoXHJcbiAgICAgICAgY29uc3QgZGlyUGF0aCA9IHBhdGguZGlybmFtZShpbWFnZS5wYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWltYWdlc0J5RGlyLmhhcyhkaXJQYXRoKSkge1xyXG4gICAgICAgICAgaW1hZ2VzQnlEaXIuc2V0KGRpclBhdGgsIFtdKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaW1hZ2VzQnlEaXIuZ2V0KGRpclBhdGgpLnB1c2goaW1hZ2UpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgZWFjaCB1bmlxdWUgZGlyZWN0b3J5IGFuZCBzYXZlIGl0cyBpbWFnZXNcclxuICAgICAgZm9yIChjb25zdCBbZGlyUGF0aCwgZGlySW1hZ2VzXSBvZiBpbWFnZXNCeURpci5lbnRyaWVzKCkpIHtcclxuICAgICAgICBjb25zdCBmdWxsRGlyUGF0aCA9IHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgZGlyUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgQ3JlYXRpbmcgaW1hZ2VzIGRpcmVjdG9yeTogJHtmdWxsRGlyUGF0aH1gKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGZ1bGxEaXJQYXRoLCB7IGlzVXJsIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNhdmUgaW1hZ2VzIHRvIHRoZWlyIHJlc3BlY3RpdmUgZGlyZWN0b3JpZXNcclxuICAgICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIGRpckltYWdlcykge1xyXG4gICAgICAgICAgaWYgKGltYWdlICYmIGltYWdlLmRhdGEpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGltYWdlLnBhdGgpO1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5K+IFNhdmluZyBpbWFnZTogJHtpbWFnZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoZSBpbWFnZSBkYXRhIGlzIGluIHRoZSByaWdodCBmb3JtYXRcclxuICAgICAgICAgICAgICBjb25zdCBpbWFnZURhdGEgPSBCdWZmZXIuaXNCdWZmZXIoaW1hZ2UuZGF0YSkgXHJcbiAgICAgICAgICAgICAgICA/IGltYWdlLmRhdGEgXHJcbiAgICAgICAgICAgICAgICA6ICh0eXBlb2YgaW1hZ2UuZGF0YSA9PT0gJ3N0cmluZycgJiYgaW1hZ2UuZGF0YS5zdGFydHNXaXRoKCdkYXRhOicpKVxyXG4gICAgICAgICAgICAgICAgICA/IEJ1ZmZlci5mcm9tKGltYWdlLmRhdGEuc3BsaXQoJywnKVsxXSwgJ2Jhc2U2NCcpXHJcbiAgICAgICAgICAgICAgICAgIDogQnVmZmVyLmZyb20oaW1hZ2UuZGF0YSwgJ2Jhc2U2NCcpO1xyXG4gICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0ud3JpdGVGaWxlKGltYWdlUGF0aCwgaW1hZ2VEYXRhLCBudWxsLCB7IGlzVXJsIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChpbWFnZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBzYXZlIGltYWdlOiAke2ltYWdlLnBhdGh9YCwgaW1hZ2VFcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIEludmFsaWQgaW1hZ2Ugb2JqZWN0OmAsIGltYWdlKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgbWFpbiBmaWxlIHBhdGhcclxuICAgIGNvbnN0IG1haW5GaWxlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/IFxyXG4gICAgICBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsICdkb2N1bWVudC5tZCcpIDogXHJcbiAgICAgIHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgYCR7YmFzZU5hbWV9Lm1kYCk7XHJcblxyXG4gICAgLy8gVXBkYXRlIGltYWdlIHJlZmVyZW5jZXMgdG8gdXNlIE9ic2lkaWFuIGZvcm1hdFxyXG4gICAgY29uc3QgdXBkYXRlZENvbnRlbnQgPSB0aGlzLnVwZGF0ZUltYWdlUmVmZXJlbmNlcyhjb250ZW50LCBpbWFnZXMpO1xyXG5cclxuICAgIC8vIENsZWFuIG1ldGFkYXRhIGZpZWxkcyBhbmQgY3JlYXRlIG1ldGFkYXRhIG9iamVjdFxyXG4gICAgY29uc3QgZnVsbE1ldGFkYXRhID0gY2xlYW5NZXRhZGF0YSh7XHJcbiAgICAgIHR5cGU6IGNvbnRlbnRUeXBlLFxyXG4gICAgICBmaWxlVHlwZTogZmlsZVR5cGUgfHwgdHlwZSwgLy8gRW5zdXJlIGZpbGVUeXBlIGlzIGluY2x1ZGVkIGluIG1ldGFkYXRhXHJcbiAgICAgIGNvbnZlcnRlZDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxyXG4gICAgICAuLi5tZXRhZGF0YVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRXh0cmFjdCBhbmQgbWVyZ2UgZnJvbnRtYXR0ZXIgaWYgaXQgZXhpc3RzXHJcbiAgICBjb25zdCB7IG1ldGFkYXRhOiBleGlzdGluZ01ldGFkYXRhLCBjb250ZW50OiBjb250ZW50V2l0aG91dEZyb250bWF0dGVyIH0gPSBleHRyYWN0RnJvbnRtYXR0ZXIodXBkYXRlZENvbnRlbnQpO1xyXG4gICAgY29uc29sZS5sb2coJ/Cfk50gRXh0cmFjdGVkIGV4aXN0aW5nIGZyb250bWF0dGVyOicsIGV4aXN0aW5nTWV0YWRhdGEpO1xyXG4gICAgXHJcbiAgICAvLyBNZXJnZSBtZXRhZGF0YSB1c2luZyBzaGFyZWQgdXRpbGl0eVxyXG4gICAgY29uc3QgbWVyZ2VkTWV0YWRhdGEgPSBtZXJnZU1ldGFkYXRhKGV4aXN0aW5nTWV0YWRhdGEsIGZ1bGxNZXRhZGF0YSwge1xyXG4gICAgICB0eXBlOiBmdWxsTWV0YWRhdGEudHlwZSwgLy8gRW5zdXJlIHR5cGUgZnJvbSBmdWxsTWV0YWRhdGEgdGFrZXMgcHJlY2VkZW5jZVxyXG4gICAgICBjb252ZXJ0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSAvLyBBbHdheXMgdXNlIGN1cnJlbnQgdGltZXN0YW1wXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgLy8gRm9ybWF0IGFuZCBjb21iaW5lIHdpdGggY29udGVudFxyXG4gICAgY29uc3QgZnJvbnRtYXR0ZXIgPSBmb3JtYXRNZXRhZGF0YShtZXJnZWRNZXRhZGF0YSk7XHJcbiAgICBjb25zdCBmdWxsQ29udGVudCA9IGZyb250bWF0dGVyICsgY29udGVudFdpdGhvdXRGcm9udG1hdHRlcjtcclxuXHJcbiAgICAvLyBTYXZlIHRoZSBtYXJrZG93biBjb250ZW50IHdpdGggVVJMIGF3YXJlbmVzc1xyXG4gICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLndyaXRlRmlsZShtYWluRmlsZVBhdGgsIGZ1bGxDb250ZW50LCAndXRmOCcsIHsgaXNVcmwgfSk7XHJcblxyXG4gICAgLy8gSGFuZGxlIGFkZGl0aW9uYWwgZmlsZXMgaWYgcHJvdmlkZWQgKGZvciBtdWx0aS1maWxlIGNvbnZlcnNpb25zIGxpa2UgcGFyZW50dXJsKVxyXG4gICAgaWYgKGZpbGVzICYmIEFycmF5LmlzQXJyYXkoZmlsZXMpICYmIGZpbGVzLmxlbmd0aCA+IDApIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4QgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBQcm9jZXNzaW5nICR7ZmlsZXMubGVuZ3RofSBhZGRpdGlvbmFsIGZpbGVzYCk7XHJcbiAgICAgIFxyXG4gICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcclxuICAgICAgICBpZiAoIWZpbGUgfHwgIWZpbGUubmFtZSB8fCAhZmlsZS5jb250ZW50KSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGZpbGUgb2JqZWN0OmAsIGZpbGUpO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBFbnN1cmUgdGhlIGRpcmVjdG9yeSBleGlzdHNcclxuICAgICAgICAgIGNvbnN0IGZpbGVEaXJQYXRoID0gcGF0aC5kaXJuYW1lKHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgZmlsZS5uYW1lKSk7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGZpbGVEaXJQYXRoLCB7IGlzVXJsIH0pO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBTYXZlIHRoZSBmaWxlXHJcbiAgICAgICAgICBjb25zdCBmaWxlUGF0aCA9IHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgZmlsZS5uYW1lKTtcclxuICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5K+IFNhdmluZyBhZGRpdGlvbmFsIGZpbGU6ICR7ZmlsZVBhdGh9YCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIERldGVybWluZSBpZiB3ZSBuZWVkIHRvIGFkZCBmcm9udG1hdHRlclxyXG4gICAgICAgICAgbGV0IGZpbGVDb250ZW50ID0gZmlsZS5jb250ZW50O1xyXG4gICAgICAgICAgaWYgKGZpbGUudHlwZSA9PT0gJ3RleHQnICYmICFmaWxlQ29udGVudC50cmltKCkuc3RhcnRzV2l0aCgnLS0tJykpIHtcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIG1ldGFkYXRhIGZvciB0aGlzIGZpbGVcclxuICAgICAgICAgICAgY29uc3QgZmlsZU1ldGFkYXRhID0gY2xlYW5NZXRhZGF0YSh7XHJcbiAgICAgICAgICAgICAgdHlwZTogZmlsZS50eXBlIHx8ICd0ZXh0JyxcclxuICAgICAgICAgICAgICBjb252ZXJ0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgICAgICAgICAuLi4oZmlsZS5tZXRhZGF0YSB8fCB7fSlcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgICAgY29uc3QgZmlsZUZyb250bWF0dGVyID0gZm9ybWF0TWV0YWRhdGEoZmlsZU1ldGFkYXRhKTtcclxuICAgICAgICAgICAgZmlsZUNvbnRlbnQgPSBmaWxlRnJvbnRtYXR0ZXIgKyBmaWxlQ29udGVudDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLndyaXRlRmlsZShmaWxlUGF0aCwgZmlsZUNvbnRlbnQsICd1dGY4JywgeyBpc1VybCB9KTtcclxuICAgICAgICB9IGNhdGNoIChmaWxlRXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gc2F2ZSBmaWxlOiAke2ZpbGUubmFtZX1gLCBmaWxlRXJyb3IpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIExvZyB0aGUgcmVzdWx0IGRldGFpbHNcclxuICAgIGNvbnNvbGUubG9nKCfwn5K+IENvbnZlcnNpb24gcmVzdWx0IHNhdmVkOicsIHtcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGgsXHJcbiAgICAgIGhhc0ltYWdlczogaW1hZ2VzICYmIGltYWdlcy5sZW5ndGggPiAwLFxyXG4gICAgICBpbWFnZUNvdW50OiBpbWFnZXMgPyBpbWFnZXMubGVuZ3RoIDogMCxcclxuICAgICAgYWRkaXRpb25hbEZpbGVzOiBmaWxlcyA/IGZpbGVzLmxlbmd0aCA6IDAsXHJcbiAgICAgIGNvbnRlbnRMZW5ndGg6IGZ1bGxDb250ZW50Lmxlbmd0aFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIFNwZWNpYWwgaGFuZGxpbmcgZm9yIGRhdGEgZmlsZXMgKENTViwgWExTWClcclxuICAgIGNvbnN0IGlzRGF0YUZpbGUgPSBjb250ZW50VHlwZSA9PT0gJ2NzdicgfHwgY29udGVudFR5cGUgPT09ICd4bHN4JyB8fFxyXG4gICAgICAgICAgICAgICAgICAgICAgZmlsZVR5cGUgPT09ICdjc3YnIHx8IGZpbGVUeXBlID09PSAneGxzeCc7XHJcbiAgICBpZiAoaXNEYXRhRmlsZSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFNwZWNpYWwgaGFuZGxpbmcgZm9yIGRhdGEgZmlsZTogJHt0eXBlfWApO1xyXG4gICAgICBcclxuICAgICAgLy8gRW5zdXJlIHdlIGhhdmUgYWxsIHJlcXVpcmVkIHByb3BlcnRpZXMgZm9yIGRhdGEgZmlsZXNcclxuICAgICAgaWYgKCFtZXRhZGF0YS5mb3JtYXQpIHtcclxuICAgICAgICBtZXRhZGF0YS5mb3JtYXQgPSB0eXBlO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIW1ldGFkYXRhLnR5cGUpIHtcclxuICAgICAgICBtZXRhZGF0YS50eXBlID0gJ3NwcmVhZHNoZWV0JztcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQWRkIGFkZGl0aW9uYWwgbG9nZ2luZyBmb3IgZGF0YSBmaWxlc1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIERhdGEgZmlsZSBtZXRhZGF0YTpgLCBtZXRhZGF0YSk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGEgdmFsaWQgb3V0cHV0IHBhdGhcclxuICAgIGlmICghb3V0cHV0QmFzZVBhdGgpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gb3V0cHV0IHBhdGggZ2VuZXJhdGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBnZW5lcmF0ZSBvdXRwdXQgcGF0aCcpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBSZXR1cm4gc3RhbmRhcmRpemVkIHJlc3VsdCB3aXRoIGd1YXJhbnRlZWQgb3V0cHV0UGF0aFxyXG4gICAgY29uc3QgcmVzdWx0ID0ge1xyXG4gICAgICBzdWNjZXNzOiB0cnVlLFxyXG4gICAgICBvdXRwdXRQYXRoOiBvdXRwdXRCYXNlUGF0aCxcclxuICAgICAgbWFpbkZpbGU6IG1haW5GaWxlUGF0aCxcclxuICAgICAgbWV0YWRhdGE6IGZ1bGxNZXRhZGF0YVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYOKchSBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFN1Y2Nlc3NmdWxseSBzYXZlZCBjb252ZXJzaW9uIHJlc3VsdDpgLCB7XHJcbiAgICAgIHR5cGU6IGNvbnRlbnRUeXBlLFxyXG4gICAgICBmaWxlVHlwZTogZmlsZVR5cGUgfHwgdHlwZSxcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGhcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgQ29udmVyc2lvblJlc3VsdE1hbmFnZXIoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU07RUFBRUM7QUFBSSxDQUFDLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDbkMsTUFBTTtFQUFFRSxRQUFRLEVBQUVDO0FBQWtCLENBQUMsR0FBR0gsT0FBTyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQztBQUN4RSxNQUFNO0VBQUVJLGNBQWM7RUFBRUMsYUFBYTtFQUFFQyxrQkFBa0I7RUFBRUM7QUFBYyxDQUFDLEdBQUdQLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztBQUN6RyxNQUFNO0VBQUVRLHNCQUFzQjtFQUFFQyxXQUFXO0VBQUVDO0FBQW9CLENBQUMsR0FBR1YsT0FBTyxDQUFDLGdCQUFnQixDQUFDOztBQUU5RjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBU1csMkJBQTJCQSxDQUFDQyxZQUFZLEVBQUVDLElBQUksRUFBRUMsUUFBUSxHQUFHLENBQUMsQ0FBQyxFQUFFO0VBQ3RFLElBQUlELElBQUksS0FBSyxLQUFLLElBQUlDLFFBQVEsQ0FBQ0MsVUFBVSxFQUFFO0lBQ3pDLE9BQU9MLG1CQUFtQixDQUFDSSxRQUFRLENBQUNDLFVBQVUsQ0FBQztFQUNqRDs7RUFFQTtFQUNBLE9BQU9QLHNCQUFzQixDQUFDSSxZQUFZLENBQUM7QUFDN0M7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNJLFlBQVlBLENBQUNDLE1BQU0sRUFBRTtFQUM1QjtFQUNBLElBQUlBLE1BQU0sS0FBSyxJQUFJLElBQUlBLE1BQU0sS0FBS0MsU0FBUyxJQUFJLE9BQU9ELE1BQU0sS0FBSyxRQUFRLEVBQUU7SUFDekVFLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLHFDQUFxQ0gsTUFBTSxFQUFFLENBQUM7SUFDM0QsT0FBTyxFQUFFO0VBQ1g7RUFFQSxJQUFJO0lBQ0YsT0FBT0EsTUFBTSxDQUFDSSxPQUFPLENBQUMscUJBQXFCLEVBQUUsTUFBTSxDQUFDO0VBQ3RELENBQUMsQ0FBQyxPQUFPQyxLQUFLLEVBQUU7SUFDZEgsT0FBTyxDQUFDRyxLQUFLLENBQUMsMEJBQTBCLEVBQUVBLEtBQUssQ0FBQztJQUNoRCxPQUFPLEVBQUU7RUFDWDtBQUNGOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTQyxLQUFLQSxDQUFDeEIsSUFBSSxFQUFFO0VBQ25CLE9BQU8sT0FBT0EsSUFBSSxLQUFLLFFBQVEsS0FBS0EsSUFBSSxDQUFDeUIsVUFBVSxDQUFDLFNBQVMsQ0FBQyxJQUFJekIsSUFBSSxDQUFDeUIsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFDO0FBQ2hHO0FBRUEsTUFBTUMsdUJBQXVCLENBQUM7RUFDNUJDLFdBQVdBLENBQUEsRUFBRztJQUNaLElBQUksQ0FBQ0MsVUFBVSxHQUFHeEIsaUJBQWlCO0lBQ25DLElBQUksQ0FBQ3lCLGdCQUFnQixHQUFHN0IsSUFBSSxDQUFDOEIsSUFBSSxDQUFDNUIsR0FBRyxDQUFDNkIsT0FBTyxDQUFDLFVBQVUsQ0FBQyxFQUFFLGFBQWEsQ0FBQztJQUV6RVgsT0FBTyxDQUFDWSxHQUFHLENBQUMsb0VBQW9FLEVBQUUsSUFBSSxDQUFDSCxnQkFBZ0IsQ0FBQztFQUMxRzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFSSxxQkFBcUJBLENBQUNDLE9BQU8sRUFBRUMsTUFBTSxFQUFFO0lBQ3JDO0lBQ0EsSUFBSSxDQUFDRCxPQUFPLElBQUksT0FBT0EsT0FBTyxLQUFLLFFBQVEsRUFBRTtNQUMzQ2QsT0FBTyxDQUFDQyxJQUFJLENBQUMsc0RBQXNELENBQUM7TUFDcEUsT0FBT2EsT0FBTyxJQUFJLEVBQUU7SUFDdEI7SUFFQSxJQUFJLENBQUNDLE1BQU0sSUFBSSxDQUFDQyxLQUFLLENBQUNDLE9BQU8sQ0FBQ0YsTUFBTSxDQUFDLElBQUlBLE1BQU0sQ0FBQ0csTUFBTSxLQUFLLENBQUMsRUFBRTtNQUM1RCxPQUFPSixPQUFPO0lBQ2hCO0lBRUEsSUFBSUssY0FBYyxHQUFHTCxPQUFPO0lBRTVCLElBQUk7TUFDRjtNQUNBO01BQ0EsTUFBTU0sc0JBQXNCLEdBQUcsc0JBQXNCO01BQ3JELE1BQU1DLGlCQUFpQixHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDOztNQUVuQztNQUNBLE1BQU1DLFVBQVUsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztNQUM1QlQsTUFBTSxDQUFDVSxPQUFPLENBQUNDLEtBQUssSUFBSTtRQUN0QixJQUFJQSxLQUFLLElBQUksT0FBT0EsS0FBSyxLQUFLLFFBQVEsRUFBRTtVQUN0QyxNQUFNQyxTQUFTLEdBQUdELEtBQUssQ0FBQzlDLElBQUksSUFBSThDLEtBQUssQ0FBQ0UsSUFBSSxLQUFLRixLQUFLLENBQUNHLEdBQUcsR0FBR0gsS0FBSyxDQUFDRyxHQUFHLEdBQUcsSUFBSSxDQUFDO1VBQzVFLElBQUlGLFNBQVMsRUFBRTtZQUNiO1lBQ0FKLFVBQVUsQ0FBQ08sR0FBRyxDQUFDSCxTQUFTLEVBQUVBLFNBQVMsQ0FBQztZQUNwQ0osVUFBVSxDQUFDTyxHQUFHLENBQUNsRCxJQUFJLENBQUNtRCxRQUFRLENBQUNKLFNBQVMsQ0FBQyxFQUFFQSxTQUFTLENBQUM7VUFDckQ7UUFDRjtNQUNGLENBQUMsQ0FBQzs7TUFFRjtNQUNBO01BQ0FSLGNBQWMsR0FBR0EsY0FBYyxDQUFDakIsT0FBTyxDQUFDa0Isc0JBQXNCLEVBQUUsQ0FBQ1ksS0FBSyxFQUFFQyxHQUFHLEVBQUVKLEdBQUcsS0FBSztRQUNuRjtRQUNBLElBQUl6QixLQUFLLENBQUN5QixHQUFHLENBQUMsRUFBRTtVQUNkLE9BQU9HLEtBQUs7UUFDZDs7UUFFQTtRQUNBLE1BQU1FLE9BQU8sR0FBR3RELElBQUksQ0FBQ21ELFFBQVEsQ0FBQ0YsR0FBRyxDQUFDOztRQUVsQztRQUNBLElBQUlOLFVBQVUsQ0FBQ1ksR0FBRyxDQUFDRCxPQUFPLENBQUMsSUFBSVgsVUFBVSxDQUFDWSxHQUFHLENBQUNOLEdBQUcsQ0FBQyxFQUFFO1VBQ2xELE1BQU1GLFNBQVMsR0FBR0osVUFBVSxDQUFDYSxHQUFHLENBQUNGLE9BQU8sQ0FBQyxJQUFJWCxVQUFVLENBQUNhLEdBQUcsQ0FBQ1AsR0FBRyxDQUFDO1VBQ2hFUixpQkFBaUIsQ0FBQ2dCLEdBQUcsQ0FBQ0gsT0FBTyxDQUFDO1VBQzlCLE9BQU8sTUFBTVAsU0FBUyxJQUFJO1FBQzVCOztRQUVBO1FBQ0EsT0FBT0ssS0FBSztNQUNkLENBQUMsQ0FBQzs7TUFFRjtNQUNBakIsTUFBTSxDQUFDVSxPQUFPLENBQUNDLEtBQUssSUFBSTtRQUN0QjtRQUNBLElBQUksQ0FBQ0EsS0FBSyxJQUFJLE9BQU9BLEtBQUssS0FBSyxRQUFRLEVBQUU7VUFDdkMxQixPQUFPLENBQUNDLElBQUksQ0FBQyxtREFBbUQsRUFBRXlCLEtBQUssQ0FBQztVQUN4RTtRQUNGO1FBRUEsSUFBSTtVQUNGO1VBQ0EsTUFBTUMsU0FBUyxHQUFHRCxLQUFLLENBQUM5QyxJQUFJLElBQUk4QyxLQUFLLENBQUNFLElBQUksS0FBS0YsS0FBSyxDQUFDRyxHQUFHLEdBQUdILEtBQUssQ0FBQ0csR0FBRyxHQUFHLElBQUksQ0FBQztVQUU1RSxJQUFJLENBQUNGLFNBQVMsRUFBRTtZQUNkM0IsT0FBTyxDQUFDQyxJQUFJLENBQUMsNENBQTRDLEVBQUV5QixLQUFLLENBQUM7WUFDakU7VUFDRjs7VUFFQTtVQUNBLE1BQU1RLE9BQU8sR0FBR3RELElBQUksQ0FBQ21ELFFBQVEsQ0FBQ0osU0FBUyxDQUFDO1VBQ3hDLElBQUlOLGlCQUFpQixDQUFDYyxHQUFHLENBQUNELE9BQU8sQ0FBQyxFQUFFO1lBQ2xDO1VBQ0Y7O1VBRUE7VUFDQSxJQUFJUixLQUFLLENBQUNHLEdBQUcsRUFBRTtZQUNiO1lBQ0EsSUFBSSxDQUFDekIsS0FBSyxDQUFDc0IsS0FBSyxDQUFDRyxHQUFHLENBQUMsRUFBRTtjQUNyQixNQUFNUyxlQUFlLEdBQUcsSUFBSUMsTUFBTSxDQUFDLG9CQUFvQjFDLFlBQVksQ0FBQzZCLEtBQUssQ0FBQ0csR0FBRyxDQUFDLFVBQVUsRUFBRSxHQUFHLENBQUM7Y0FDOUZWLGNBQWMsR0FBR0EsY0FBYyxDQUFDakIsT0FBTyxDQUFDb0MsZUFBZSxFQUFFLE1BQU1YLFNBQVMsSUFBSSxDQUFDO1lBQy9FO1VBQ0Y7O1VBRUE7VUFDQTtVQUNBLElBQUksQ0FBQ3ZCLEtBQUssQ0FBQ3VCLFNBQVMsQ0FBQyxFQUFFO1lBQ3JCLE1BQU1hLGtCQUFrQixHQUFHLElBQUlELE1BQU0sQ0FBQyxvQkFBb0IxQyxZQUFZLENBQUM4QixTQUFTLENBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQztZQUNqR1IsY0FBYyxHQUFHQSxjQUFjLENBQUNqQixPQUFPLENBQUNzQyxrQkFBa0IsRUFBRSxNQUFNYixTQUFTLElBQUksQ0FBQztVQUNsRjs7VUFFQTtVQUNBLE1BQU1jLGVBQWUsR0FBRyxJQUFJRixNQUFNLENBQUMsc0JBQXNCLEVBQUUsR0FBRyxDQUFDO1VBQy9EO1VBQ0EsSUFBSSxDQUFDbkMsS0FBSyxDQUFDdUIsU0FBUyxDQUFDLEVBQUU7WUFDckIsTUFBTWUscUJBQXFCLEdBQUcsTUFBTWYsU0FBUyxJQUFJO1lBQ2pELElBQUksQ0FBQ1IsY0FBYyxDQUFDd0IsUUFBUSxDQUFDRCxxQkFBcUIsQ0FBQyxFQUFFO2NBQ25EO2NBQ0EsTUFBTUUsT0FBTyxHQUFHekIsY0FBYyxDQUFDYSxLQUFLLENBQUNTLGVBQWUsQ0FBQztjQUNyRCxJQUFJRyxPQUFPLEVBQUU7Z0JBQ1g7Z0JBQ0FBLE9BQU8sQ0FBQ25CLE9BQU8sQ0FBQ08sS0FBSyxJQUFJO2tCQUN2QjtrQkFDQSxNQUFNYSxTQUFTLEdBQUdiLEtBQUssQ0FBQ2MsU0FBUyxDQUFDLENBQUMsRUFBRWQsS0FBSyxDQUFDZCxNQUFNLEdBQUcsQ0FBQyxDQUFDOztrQkFFdEQ7a0JBQ0EsSUFBSTJCLFNBQVMsQ0FBQ0YsUUFBUSxDQUFDL0QsSUFBSSxDQUFDbUQsUUFBUSxDQUFDSixTQUFTLEVBQUUvQyxJQUFJLENBQUNtRSxPQUFPLENBQUNwQixTQUFTLENBQUMsQ0FBQyxDQUFDLEVBQUU7b0JBQ3pFUixjQUFjLEdBQUdBLGNBQWMsQ0FBQ2pCLE9BQU8sQ0FBQzhCLEtBQUssRUFBRVUscUJBQXFCLENBQUM7a0JBQ3ZFO2dCQUNGLENBQUMsQ0FBQztjQUNKO1lBQ0Y7VUFDRjtRQUNGLENBQUMsQ0FBQyxPQUFPTSxVQUFVLEVBQUU7VUFDbkJoRCxPQUFPLENBQUNDLElBQUksQ0FBQyxzQ0FBc0MsRUFBRStDLFVBQVUsQ0FBQztVQUNoRTtRQUNGO01BQ0YsQ0FBQyxDQUFDOztNQUVGO01BQ0EsTUFBTUMsc0JBQXNCLEdBQUcsc0RBQXNEO01BQ3JGOUIsY0FBYyxHQUFHQSxjQUFjLENBQUNqQixPQUFPLENBQUMrQyxzQkFBc0IsRUFBRSxFQUFFLENBQUM7SUFFckUsQ0FBQyxDQUFDLE9BQU85QyxLQUFLLEVBQUU7TUFDZEgsT0FBTyxDQUFDRyxLQUFLLENBQUMsbUNBQW1DLEVBQUVBLEtBQUssQ0FBQztNQUN6RDtNQUNBLE9BQU9XLE9BQU87SUFDaEI7SUFFQSxPQUFPSyxjQUFjO0VBQ3ZCOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTStCLG9CQUFvQkEsQ0FBQztJQUFFcEMsT0FBTztJQUFFbkIsUUFBUSxHQUFHLENBQUMsQ0FBQztJQUFFb0IsTUFBTSxHQUFHLEVBQUU7SUFBRW9DLEtBQUssR0FBRyxFQUFFO0lBQUV2QixJQUFJO0lBQUVsQyxJQUFJO0lBQUUwRCxRQUFRO0lBQUVDLFNBQVM7SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFDLEVBQUU7SUFDN0h0RCxPQUFPLENBQUNZLEdBQUcsQ0FBQyw2REFBNkRnQixJQUFJLEtBQUtsQyxJQUFJLElBQUkwRCxRQUFRLEdBQUcsQ0FBQzs7SUFFdEc7SUFDQSxJQUFJLENBQUN0QyxPQUFPLEVBQUU7TUFDWmQsT0FBTyxDQUFDRyxLQUFLLENBQUMsa0RBQWtELENBQUM7TUFDakUsTUFBTSxJQUFJb0QsS0FBSyxDQUFDLDJDQUEyQyxDQUFDO0lBQzlEO0lBRUEsSUFBSSxDQUFDM0IsSUFBSSxFQUFFO01BQ1Q1QixPQUFPLENBQUNHLEtBQUssQ0FBQywrQ0FBK0MsQ0FBQztNQUM5RCxNQUFNLElBQUlvRCxLQUFLLENBQUMsd0NBQXdDLENBQUM7SUFDM0Q7SUFFQSxJQUFJLENBQUM3RCxJQUFJLElBQUksQ0FBQzBELFFBQVEsRUFBRTtNQUN0QnBELE9BQU8sQ0FBQ0csS0FBSyxDQUFDLDJEQUEyRCxDQUFDO01BQzFFLE1BQU0sSUFBSW9ELEtBQUssQ0FBQyxvREFBb0QsQ0FBQztJQUN2RTs7SUFFQTtJQUNBLE1BQU1DLFdBQVcsR0FBRzlELElBQUksSUFBSTBELFFBQVE7SUFFcEMsSUFBSSxDQUFDQyxTQUFTLEVBQUU7TUFDZHJELE9BQU8sQ0FBQ0csS0FBSyxDQUFDLDJEQUEyRCxDQUFDO01BQzFFSCxPQUFPLENBQUNZLEdBQUcsQ0FBQyw4REFBOEQsRUFBRSxJQUFJLENBQUNILGdCQUFnQixDQUFDO0lBQ3BHOztJQUVBO0lBQ0EsTUFBTWdELGFBQWEsR0FBR0osU0FBUyxJQUFJLElBQUksQ0FBQzVDLGdCQUFnQjs7SUFFeEQ7SUFDQSxNQUFNaUQscUJBQXFCLEdBQUcsQ0FBQyxDQUFDTCxTQUFTO0lBQ3pDLE1BQU1NLGtCQUFrQixHQUFHRCxxQkFBcUIsR0FBRyxLQUFLLEdBQzlCSixPQUFPLENBQUNLLGtCQUFrQixLQUFLNUQsU0FBUyxHQUFHdUQsT0FBTyxDQUFDSyxrQkFBa0IsR0FBRyxJQUFLOztJQUV4RztJQUNBLE1BQU1DLFFBQVEsR0FBR3BFLDJCQUEyQixDQUFDb0MsSUFBSSxFQUFFNEIsV0FBVyxFQUFFN0QsUUFBUSxDQUFDOztJQUV6RTtJQUNBLE1BQU1TLEtBQUssR0FBR29ELFdBQVcsS0FBSyxLQUFLLElBQUlBLFdBQVcsS0FBSyxXQUFXOztJQUVqRTtJQUNBLE1BQU1LLFFBQVEsR0FBR3ZFLFdBQVcsQ0FBQ3NFLFFBQVEsQ0FBQyxDQUFDMUQsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFDQSxPQUFPLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQztJQUMxRixNQUFNNEQsY0FBYyxHQUFHSCxrQkFBa0IsR0FDdkMvRSxJQUFJLENBQUM4QixJQUFJLENBQUMrQyxhQUFhLEVBQUUsR0FBR0ksUUFBUSxJQUFJRSxJQUFJLENBQUNDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUNyRFAsYUFBYTtJQUVmekQsT0FBTyxDQUFDWSxHQUFHLENBQUMsdURBQXVEa0QsY0FBYyxFQUFFLENBQUM7O0lBRXBGO0lBQ0EsSUFBSTtNQUNGLE1BQU0sSUFBSSxDQUFDdEQsVUFBVSxDQUFDeUQsZUFBZSxDQUFDSCxjQUFjLEVBQUU7UUFBRTFEO01BQU0sQ0FBQyxDQUFDO01BQ2hFSixPQUFPLENBQUNZLEdBQUcsQ0FBQyx5REFBeURrRCxjQUFjLEVBQUUsQ0FBQztJQUN4RixDQUFDLENBQUMsT0FBTzNELEtBQUssRUFBRTtNQUNkSCxPQUFPLENBQUNHLEtBQUssQ0FBQyxrRUFBa0VBLEtBQUssQ0FBQytELE9BQU8sRUFBRSxDQUFDO01BQ2hHLE1BQU0sSUFBSVgsS0FBSyxDQUFDLHNDQUFzQ3BELEtBQUssQ0FBQytELE9BQU8sRUFBRSxDQUFDO0lBQ3hFOztJQUVBO0lBQ0EsSUFBSW5ELE1BQU0sSUFBSUEsTUFBTSxDQUFDRyxNQUFNLEdBQUcsQ0FBQyxFQUFFO01BQy9CO01BQ0EsTUFBTWlELFdBQVcsR0FBRyxJQUFJM0MsR0FBRyxDQUFDLENBQUM7TUFFN0IsS0FBSyxNQUFNRSxLQUFLLElBQUlYLE1BQU0sRUFBRTtRQUMxQixJQUFJLENBQUNXLEtBQUssSUFBSSxDQUFDQSxLQUFLLENBQUM5QyxJQUFJLEVBQUU7VUFDekJvQixPQUFPLENBQUNDLElBQUksQ0FBQywwQ0FBMEMsRUFBRXlCLEtBQUssQ0FBQztVQUMvRDtRQUNGOztRQUVBO1FBQ0EsTUFBTTBDLE9BQU8sR0FBR3hGLElBQUksQ0FBQ3lGLE9BQU8sQ0FBQzNDLEtBQUssQ0FBQzlDLElBQUksQ0FBQztRQUV4QyxJQUFJLENBQUN1RixXQUFXLENBQUNoQyxHQUFHLENBQUNpQyxPQUFPLENBQUMsRUFBRTtVQUM3QkQsV0FBVyxDQUFDckMsR0FBRyxDQUFDc0MsT0FBTyxFQUFFLEVBQUUsQ0FBQztRQUM5QjtRQUVBRCxXQUFXLENBQUMvQixHQUFHLENBQUNnQyxPQUFPLENBQUMsQ0FBQ0UsSUFBSSxDQUFDNUMsS0FBSyxDQUFDO01BQ3RDOztNQUVBO01BQ0EsS0FBSyxNQUFNLENBQUMwQyxPQUFPLEVBQUVHLFNBQVMsQ0FBQyxJQUFJSixXQUFXLENBQUNLLE9BQU8sQ0FBQyxDQUFDLEVBQUU7UUFDeEQsTUFBTUMsV0FBVyxHQUFHN0YsSUFBSSxDQUFDOEIsSUFBSSxDQUFDb0QsY0FBYyxFQUFFTSxPQUFPLENBQUM7UUFDdERwRSxPQUFPLENBQUNZLEdBQUcsQ0FBQyxpQ0FBaUM2RCxXQUFXLEVBQUUsQ0FBQztRQUMzRCxNQUFNLElBQUksQ0FBQ2pFLFVBQVUsQ0FBQ3lELGVBQWUsQ0FBQ1EsV0FBVyxFQUFFO1VBQUVyRTtRQUFNLENBQUMsQ0FBQzs7UUFFN0Q7UUFDQSxLQUFLLE1BQU1zQixLQUFLLElBQUk2QyxTQUFTLEVBQUU7VUFDN0IsSUFBSTdDLEtBQUssSUFBSUEsS0FBSyxDQUFDZ0QsSUFBSSxFQUFFO1lBQ3ZCLElBQUk7Y0FDRixNQUFNL0MsU0FBUyxHQUFHL0MsSUFBSSxDQUFDOEIsSUFBSSxDQUFDb0QsY0FBYyxFQUFFcEMsS0FBSyxDQUFDOUMsSUFBSSxDQUFDO2NBQ3ZEb0IsT0FBTyxDQUFDWSxHQUFHLENBQUMsb0JBQW9CZSxTQUFTLEVBQUUsQ0FBQzs7Y0FFNUM7Y0FDQSxNQUFNZ0QsU0FBUyxHQUFHQyxNQUFNLENBQUNDLFFBQVEsQ0FBQ25ELEtBQUssQ0FBQ2dELElBQUksQ0FBQyxHQUN6Q2hELEtBQUssQ0FBQ2dELElBQUksR0FDVCxPQUFPaEQsS0FBSyxDQUFDZ0QsSUFBSSxLQUFLLFFBQVEsSUFBSWhELEtBQUssQ0FBQ2dELElBQUksQ0FBQ3JFLFVBQVUsQ0FBQyxPQUFPLENBQUMsR0FDL0R1RSxNQUFNLENBQUNFLElBQUksQ0FBQ3BELEtBQUssQ0FBQ2dELElBQUksQ0FBQ0ssS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxHQUMvQ0gsTUFBTSxDQUFDRSxJQUFJLENBQUNwRCxLQUFLLENBQUNnRCxJQUFJLEVBQUUsUUFBUSxDQUFDO2NBRXZDLE1BQU0sSUFBSSxDQUFDbEUsVUFBVSxDQUFDd0UsU0FBUyxDQUFDckQsU0FBUyxFQUFFZ0QsU0FBUyxFQUFFLElBQUksRUFBRTtnQkFBRXZFO2NBQU0sQ0FBQyxDQUFDO1lBQ3hFLENBQUMsQ0FBQyxPQUFPNEMsVUFBVSxFQUFFO2NBQ25CaEQsT0FBTyxDQUFDRyxLQUFLLENBQUMsMkJBQTJCdUIsS0FBSyxDQUFDOUMsSUFBSSxFQUFFLEVBQUVvRSxVQUFVLENBQUM7WUFDcEU7VUFDRixDQUFDLE1BQU07WUFDTGhELE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLDBCQUEwQixFQUFFeUIsS0FBSyxDQUFDO1VBQ2pEO1FBQ0Y7TUFDRjtJQUNGOztJQUVBO0lBQ0EsTUFBTXVELFlBQVksR0FBR3RCLGtCQUFrQixHQUNyQy9FLElBQUksQ0FBQzhCLElBQUksQ0FBQ29ELGNBQWMsRUFBRSxhQUFhLENBQUMsR0FDeENsRixJQUFJLENBQUM4QixJQUFJLENBQUNvRCxjQUFjLEVBQUUsR0FBR0QsUUFBUSxLQUFLLENBQUM7O0lBRTdDO0lBQ0EsTUFBTTFDLGNBQWMsR0FBRyxJQUFJLENBQUNOLHFCQUFxQixDQUFDQyxPQUFPLEVBQUVDLE1BQU0sQ0FBQzs7SUFFbEU7SUFDQSxNQUFNbUUsWUFBWSxHQUFHaEcsYUFBYSxDQUFDO01BQ2pDUSxJQUFJLEVBQUU4RCxXQUFXO01BQ2pCSixRQUFRLEVBQUVBLFFBQVEsSUFBSTFELElBQUk7TUFBRTtNQUM1QnlGLFNBQVMsRUFBRSxJQUFJcEIsSUFBSSxDQUFDLENBQUMsQ0FBQ3FCLFdBQVcsQ0FBQyxDQUFDO01BQ25DLEdBQUd6RjtJQUNMLENBQUMsQ0FBQzs7SUFFRjtJQUNBLE1BQU07TUFBRUEsUUFBUSxFQUFFMEYsZ0JBQWdCO01BQUV2RSxPQUFPLEVBQUV3RTtJQUEwQixDQUFDLEdBQUduRyxrQkFBa0IsQ0FBQ2dDLGNBQWMsQ0FBQztJQUM3R25CLE9BQU8sQ0FBQ1ksR0FBRyxDQUFDLG9DQUFvQyxFQUFFeUUsZ0JBQWdCLENBQUM7O0lBRW5FO0lBQ0EsTUFBTUUsY0FBYyxHQUFHbkcsYUFBYSxDQUFDaUcsZ0JBQWdCLEVBQUVILFlBQVksRUFBRTtNQUNuRXhGLElBQUksRUFBRXdGLFlBQVksQ0FBQ3hGLElBQUk7TUFBRTtNQUN6QnlGLFNBQVMsRUFBRSxJQUFJcEIsSUFBSSxDQUFDLENBQUMsQ0FBQ3FCLFdBQVcsQ0FBQyxDQUFDLENBQUM7SUFDdEMsQ0FBQyxDQUFDOztJQUVGO0lBQ0EsTUFBTUksV0FBVyxHQUFHdkcsY0FBYyxDQUFDc0csY0FBYyxDQUFDO0lBQ2xELE1BQU1FLFdBQVcsR0FBR0QsV0FBVyxHQUFHRix5QkFBeUI7O0lBRTNEO0lBQ0EsTUFBTSxJQUFJLENBQUM5RSxVQUFVLENBQUN3RSxTQUFTLENBQUNDLFlBQVksRUFBRVEsV0FBVyxFQUFFLE1BQU0sRUFBRTtNQUFFckY7SUFBTSxDQUFDLENBQUM7O0lBRTdFO0lBQ0EsSUFBSStDLEtBQUssSUFBSW5DLEtBQUssQ0FBQ0MsT0FBTyxDQUFDa0MsS0FBSyxDQUFDLElBQUlBLEtBQUssQ0FBQ2pDLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDckRsQixPQUFPLENBQUNZLEdBQUcsQ0FBQywyQ0FBMkN1QyxLQUFLLENBQUNqQyxNQUFNLG1CQUFtQixDQUFDO01BRXZGLEtBQUssTUFBTXdFLElBQUksSUFBSXZDLEtBQUssRUFBRTtRQUN4QixJQUFJLENBQUN1QyxJQUFJLElBQUksQ0FBQ0EsSUFBSSxDQUFDOUQsSUFBSSxJQUFJLENBQUM4RCxJQUFJLENBQUM1RSxPQUFPLEVBQUU7VUFDeENkLE9BQU8sQ0FBQ0MsSUFBSSxDQUFDLHlCQUF5QixFQUFFeUYsSUFBSSxDQUFDO1VBQzdDO1FBQ0Y7UUFFQSxJQUFJO1VBQ0Y7VUFDQSxNQUFNQyxXQUFXLEdBQUcvRyxJQUFJLENBQUN5RixPQUFPLENBQUN6RixJQUFJLENBQUM4QixJQUFJLENBQUNvRCxjQUFjLEVBQUU0QixJQUFJLENBQUM5RCxJQUFJLENBQUMsQ0FBQztVQUN0RSxNQUFNLElBQUksQ0FBQ3BCLFVBQVUsQ0FBQ3lELGVBQWUsQ0FBQzBCLFdBQVcsRUFBRTtZQUFFdkY7VUFBTSxDQUFDLENBQUM7O1VBRTdEO1VBQ0EsTUFBTXdGLFFBQVEsR0FBR2hILElBQUksQ0FBQzhCLElBQUksQ0FBQ29ELGNBQWMsRUFBRTRCLElBQUksQ0FBQzlELElBQUksQ0FBQztVQUNyRDVCLE9BQU8sQ0FBQ1ksR0FBRyxDQUFDLDhCQUE4QmdGLFFBQVEsRUFBRSxDQUFDOztVQUVyRDtVQUNBLElBQUlDLFdBQVcsR0FBR0gsSUFBSSxDQUFDNUUsT0FBTztVQUM5QixJQUFJNEUsSUFBSSxDQUFDaEcsSUFBSSxLQUFLLE1BQU0sSUFBSSxDQUFDbUcsV0FBVyxDQUFDQyxJQUFJLENBQUMsQ0FBQyxDQUFDekYsVUFBVSxDQUFDLEtBQUssQ0FBQyxFQUFFO1lBQ2pFO1lBQ0EsTUFBTTBGLFlBQVksR0FBRzdHLGFBQWEsQ0FBQztjQUNqQ1EsSUFBSSxFQUFFZ0csSUFBSSxDQUFDaEcsSUFBSSxJQUFJLE1BQU07Y0FDekJ5RixTQUFTLEVBQUUsSUFBSXBCLElBQUksQ0FBQyxDQUFDLENBQUNxQixXQUFXLENBQUMsQ0FBQztjQUNuQyxJQUFJTSxJQUFJLENBQUMvRixRQUFRLElBQUksQ0FBQyxDQUFDO1lBQ3pCLENBQUMsQ0FBQzs7WUFFRjtZQUNBLE1BQU1xRyxlQUFlLEdBQUcvRyxjQUFjLENBQUM4RyxZQUFZLENBQUM7WUFDcERGLFdBQVcsR0FBR0csZUFBZSxHQUFHSCxXQUFXO1VBQzdDO1VBRUEsTUFBTSxJQUFJLENBQUNyRixVQUFVLENBQUN3RSxTQUFTLENBQUNZLFFBQVEsRUFBRUMsV0FBVyxFQUFFLE1BQU0sRUFBRTtZQUFFekY7VUFBTSxDQUFDLENBQUM7UUFDM0UsQ0FBQyxDQUFDLE9BQU82RixTQUFTLEVBQUU7VUFDbEJqRyxPQUFPLENBQUNHLEtBQUssQ0FBQywwQkFBMEJ1RixJQUFJLENBQUM5RCxJQUFJLEVBQUUsRUFBRXFFLFNBQVMsQ0FBQztRQUNqRTtNQUNGO0lBQ0Y7O0lBRUE7SUFDQWpHLE9BQU8sQ0FBQ1ksR0FBRyxDQUFDLDZCQUE2QixFQUFFO01BQ3pDc0YsVUFBVSxFQUFFcEMsY0FBYztNQUMxQnFDLFFBQVEsRUFBRWxCLFlBQVk7TUFDdEJtQixTQUFTLEVBQUVyRixNQUFNLElBQUlBLE1BQU0sQ0FBQ0csTUFBTSxHQUFHLENBQUM7TUFDdENtRixVQUFVLEVBQUV0RixNQUFNLEdBQUdBLE1BQU0sQ0FBQ0csTUFBTSxHQUFHLENBQUM7TUFDdENvRixlQUFlLEVBQUVuRCxLQUFLLEdBQUdBLEtBQUssQ0FBQ2pDLE1BQU0sR0FBRyxDQUFDO01BQ3pDcUYsYUFBYSxFQUFFZCxXQUFXLENBQUN2RTtJQUM3QixDQUFDLENBQUM7O0lBRUY7SUFDQSxNQUFNc0YsVUFBVSxHQUFHaEQsV0FBVyxLQUFLLEtBQUssSUFBSUEsV0FBVyxLQUFLLE1BQU0sSUFDaERKLFFBQVEsS0FBSyxLQUFLLElBQUlBLFFBQVEsS0FBSyxNQUFNO0lBQzNELElBQUlvRCxVQUFVLEVBQUU7TUFDZHhHLE9BQU8sQ0FBQ1ksR0FBRyxDQUFDLGdFQUFnRWxCLElBQUksRUFBRSxDQUFDOztNQUVuRjtNQUNBLElBQUksQ0FBQ0MsUUFBUSxDQUFDOEcsTUFBTSxFQUFFO1FBQ3BCOUcsUUFBUSxDQUFDOEcsTUFBTSxHQUFHL0csSUFBSTtNQUN4QjtNQUVBLElBQUksQ0FBQ0MsUUFBUSxDQUFDRCxJQUFJLEVBQUU7UUFDbEJDLFFBQVEsQ0FBQ0QsSUFBSSxHQUFHLGFBQWE7TUFDL0I7O01BRUE7TUFDQU0sT0FBTyxDQUFDWSxHQUFHLENBQUMsa0RBQWtELEVBQUVqQixRQUFRLENBQUM7SUFDM0U7O0lBRUE7SUFDQSxJQUFJLENBQUNtRSxjQUFjLEVBQUU7TUFDbkI5RCxPQUFPLENBQUNHLEtBQUssQ0FBQyx1REFBdUQsQ0FBQztNQUN0RSxNQUFNLElBQUlvRCxLQUFLLENBQUMsZ0NBQWdDLENBQUM7SUFDbkQ7O0lBRUE7SUFDQSxNQUFNbUQsTUFBTSxHQUFHO01BQ2JDLE9BQU8sRUFBRSxJQUFJO01BQ2JULFVBQVUsRUFBRXBDLGNBQWM7TUFDMUJxQyxRQUFRLEVBQUVsQixZQUFZO01BQ3RCdEYsUUFBUSxFQUFFdUY7SUFDWixDQUFDO0lBRURsRixPQUFPLENBQUNZLEdBQUcsQ0FBQyxtRUFBbUUsRUFBRTtNQUMvRWxCLElBQUksRUFBRThELFdBQVc7TUFDakJKLFFBQVEsRUFBRUEsUUFBUSxJQUFJMUQsSUFBSTtNQUMxQndHLFVBQVUsRUFBRXBDLGNBQWM7TUFDMUJxQyxRQUFRLEVBQUVsQjtJQUNaLENBQUMsQ0FBQztJQUVGLE9BQU95QixNQUFNO0VBQ2Y7QUFDRjtBQUVBRSxNQUFNLENBQUNDLE9BQU8sR0FBRyxJQUFJdkcsdUJBQXVCLENBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==