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
const FileSystemService = require('./FileSystemService');
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsIkZpbGVTeXN0ZW1TZXJ2aWNlIiwiZm9ybWF0TWV0YWRhdGEiLCJjbGVhbk1ldGFkYXRhIiwiZXh0cmFjdEZyb250bWF0dGVyIiwibWVyZ2VNZXRhZGF0YSIsImNsZWFuVGVtcG9yYXJ5RmlsZW5hbWUiLCJnZXRCYXNlbmFtZSIsImdlbmVyYXRlVXJsRmlsZW5hbWUiLCJnZW5lcmF0ZUFwcHJvcHJpYXRlRmlsZW5hbWUiLCJvcmlnaW5hbE5hbWUiLCJ0eXBlIiwibWV0YWRhdGEiLCJzb3VyY2VfdXJsIiwiZXNjYXBlUmVnRXhwIiwic3RyaW5nIiwidW5kZWZpbmVkIiwiY29uc29sZSIsIndhcm4iLCJyZXBsYWNlIiwiZXJyb3IiLCJpc1VybCIsInN0YXJ0c1dpdGgiLCJDb252ZXJzaW9uUmVzdWx0TWFuYWdlciIsImNvbnN0cnVjdG9yIiwiZmlsZVN5c3RlbSIsImRlZmF1bHRPdXRwdXREaXIiLCJqb2luIiwiZ2V0UGF0aCIsImxvZyIsInVwZGF0ZUltYWdlUmVmZXJlbmNlcyIsImNvbnRlbnQiLCJpbWFnZXMiLCJBcnJheSIsImlzQXJyYXkiLCJsZW5ndGgiLCJ1cGRhdGVkQ29udGVudCIsImdlbmVyaWNNYXJrZG93blBhdHRlcm4iLCJwcm9jZXNzZWRJbWFnZUlkcyIsIlNldCIsImltYWdlUGF0aHMiLCJNYXAiLCJmb3JFYWNoIiwiaW1hZ2UiLCJpbWFnZVBhdGgiLCJuYW1lIiwic3JjIiwic2V0IiwiYmFzZW5hbWUiLCJtYXRjaCIsImFsdCIsImltYWdlSWQiLCJoYXMiLCJnZXQiLCJhZGQiLCJtYXJrZG93blBhdHRlcm4iLCJSZWdFeHAiLCJtYXJrZG93bkFueVBhdHRlcm4iLCJvYnNpZGlhblBhdHRlcm4iLCJjb3JyZWN0T2JzaWRpYW5Gb3JtYXQiLCJpbmNsdWRlcyIsIm1hdGNoZXMiLCJtYXRjaFBhdGgiLCJzdWJzdHJpbmciLCJleHRuYW1lIiwiaW1hZ2VFcnJvciIsImV4dHJhY3RlZEltYWdlc1BhdHRlcm4iLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImZpbGVzIiwiZmlsZVR5cGUiLCJvdXRwdXREaXIiLCJvcHRpb25zIiwiRXJyb3IiLCJjb250ZW50VHlwZSIsImJhc2VPdXRwdXREaXIiLCJ1c2VyUHJvdmlkZWRPdXRwdXREaXIiLCJjcmVhdGVTdWJkaXJlY3RvcnkiLCJmaWxlbmFtZSIsImJhc2VOYW1lIiwib3V0cHV0QmFzZVBhdGgiLCJEYXRlIiwibm93IiwiY3JlYXRlRGlyZWN0b3J5IiwibWVzc2FnZSIsImltYWdlc0J5RGlyIiwiZGlyUGF0aCIsImRpcm5hbWUiLCJwdXNoIiwiZGlySW1hZ2VzIiwiZW50cmllcyIsImZ1bGxEaXJQYXRoIiwiZGF0YSIsImltYWdlRGF0YSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZnJvbSIsInNwbGl0Iiwid3JpdGVGaWxlIiwibWFpbkZpbGVQYXRoIiwiZnVsbE1ldGFkYXRhIiwiY29udmVydGVkIiwidG9JU09TdHJpbmciLCJleGlzdGluZ01ldGFkYXRhIiwiY29udGVudFdpdGhvdXRGcm9udG1hdHRlciIsIm1lcmdlZE1ldGFkYXRhIiwiZnJvbnRtYXR0ZXIiLCJmdWxsQ29udGVudCIsImZpbGUiLCJmaWxlRGlyUGF0aCIsImZpbGVQYXRoIiwiZmlsZUNvbnRlbnQiLCJ0cmltIiwiZmlsZU1ldGFkYXRhIiwiZmlsZUZyb250bWF0dGVyIiwiZmlsZUVycm9yIiwib3V0cHV0UGF0aCIsIm1haW5GaWxlIiwiaGFzSW1hZ2VzIiwiaW1hZ2VDb3VudCIsImFkZGl0aW9uYWxGaWxlcyIsImNvbnRlbnRMZW5ndGgiLCJpc0RhdGFGaWxlIiwiZm9ybWF0IiwicmVzdWx0Iiwic3VjY2VzcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvQ29udmVyc2lvblJlc3VsdE1hbmFnZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyLmpzXHJcbiAqIFxyXG4gKiBIYW5kbGVzIHNhdmluZyBjb252ZXJzaW9uIHJlc3VsdHMgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZy5cclxuICogTWFuYWdlcyBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZSwgaW1hZ2Ugc2F2aW5nLCBhbmQgbWV0YWRhdGEgZm9ybWF0dGluZy5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBzYXZpbmcgY29udmVyc2lvbiByZXN1bHRzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIHN5c3RlbSBvcGVyYXRpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL2FkYXB0ZXJzL21ldGFkYXRhRXh0cmFjdG9yQWRhcHRlci5qczogVXNlZCBmb3IgbWV0YWRhdGEgZm9ybWF0dGluZ1xyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBGaWxlU3lzdGVtU2VydmljZSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTtcclxuY29uc3QgeyBmb3JtYXRNZXRhZGF0YSwgY2xlYW5NZXRhZGF0YSwgZXh0cmFjdEZyb250bWF0dGVyLCBtZXJnZU1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi91dGlscy9tYXJrZG93bicpO1xyXG5jb25zdCB7IGNsZWFuVGVtcG9yYXJ5RmlsZW5hbWUsIGdldEJhc2VuYW1lLCBnZW5lcmF0ZVVybEZpbGVuYW1lIH0gPSByZXF1aXJlKCcuLi91dGlscy9maWxlcycpO1xyXG5cclxuLyoqXHJcbiAqIEdlbmVyYXRlIGFwcHJvcHJpYXRlIGZpbGVuYW1lIGJhc2VkIG9uIGNvbnZlcnNpb24gdHlwZSBhbmQgbWV0YWRhdGFcclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtzdHJpbmd9IG9yaWdpbmFsTmFtZSAtIE9yaWdpbmFsIGZpbGVuYW1lIG9yIFVSTFxyXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFR5cGUgb2YgY29udmVyc2lvbiAoZS5nLiwgJ3VybCcsICdwZGYnKVxyXG4gKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBNZXRhZGF0YSBmcm9tIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGFwcHJvcHJpYXRlIGZpbGVuYW1lXHJcbiAqL1xyXG5mdW5jdGlvbiBnZW5lcmF0ZUFwcHJvcHJpYXRlRmlsZW5hbWUob3JpZ2luYWxOYW1lLCB0eXBlLCBtZXRhZGF0YSA9IHt9KSB7XHJcbiAgaWYgKHR5cGUgPT09ICd1cmwnICYmIG1ldGFkYXRhLnNvdXJjZV91cmwpIHtcclxuICAgIHJldHVybiBnZW5lcmF0ZVVybEZpbGVuYW1lKG1ldGFkYXRhLnNvdXJjZV91cmwpO1xyXG4gIH1cclxuICBcclxuICAvLyBGb3IgcmVndWxhciBmaWxlcywgY2xlYW4gdGhlIG9yaWdpbmFsIG5hbWVcclxuICByZXR1cm4gY2xlYW5UZW1wb3JhcnlGaWxlbmFtZShvcmlnaW5hbE5hbWUpO1xyXG59XHJcblxyXG4vKipcclxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGVzY2FwZSBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gcmVndWxhciBleHByZXNzaW9uc1xyXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gVGhlIHN0cmluZyB0byBlc2NhcGVcclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGVzY2FwZWQgc3RyaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyaW5nKSB7XHJcbiAgLy8gSGFuZGxlIG51bGwsIHVuZGVmaW5lZCwgb3Igbm9uLXN0cmluZyBpbnB1dHNcclxuICBpZiAoc3RyaW5nID09PSBudWxsIHx8IHN0cmluZyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSB7XHJcbiAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGlucHV0IHRvIGVzY2FwZVJlZ0V4cDogJHtzdHJpbmd9YCk7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBpbiBlc2NhcGVSZWdFeHA6YCwgZXJyb3IpO1xyXG4gICAgcmV0dXJuICcnO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBhIHBhdGggaXMgYSBVUkxcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBjaGVja1xyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGF0aCBpcyBhIFVSTFxyXG4gKi9cclxuZnVuY3Rpb24gaXNVcmwocGF0aCkge1xyXG4gIHJldHVybiB0eXBlb2YgcGF0aCA9PT0gJ3N0cmluZycgJiYgKHBhdGguc3RhcnRzV2l0aCgnaHR0cDovLycpIHx8IHBhdGguc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSk7XHJcbn1cclxuXHJcbmNsYXNzIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlO1xyXG4gICAgdGhpcy5kZWZhdWx0T3V0cHV0RGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY29udmVyc2lvbnMnKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIGluaXRpYWxpemVkIHdpdGggZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgaW1hZ2UgcmVmZXJlbmNlcyB0byB1c2UgT2JzaWRpYW4gZm9ybWF0XHJcbiAgICogQHByaXZhdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29udGVudCAtIFRoZSBjb250ZW50IHRvIHVwZGF0ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IGltYWdlcyAtIEFycmF5IG9mIGltYWdlIG9iamVjdHNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVcGRhdGVkIGNvbnRlbnQgd2l0aCBPYnNpZGlhbiBpbWFnZSByZWZlcmVuY2VzXHJcbiAgICovXHJcbiAgdXBkYXRlSW1hZ2VSZWZlcmVuY2VzKGNvbnRlbnQsIGltYWdlcykge1xyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXHJcbiAgICBpZiAoIWNvbnRlbnQgfHwgdHlwZW9mIGNvbnRlbnQgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEludmFsaWQgY29udGVudCBwcm92aWRlZCB0byB1cGRhdGVJbWFnZVJlZmVyZW5jZXMnKTtcclxuICAgICAgcmV0dXJuIGNvbnRlbnQgfHwgJyc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghaW1hZ2VzIHx8ICFBcnJheS5pc0FycmF5KGltYWdlcykgfHwgaW1hZ2VzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gY29udGVudDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gY29udGVudDtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRmlyc3QsIGhhbmRsZSBhbnkgZ2VuZXJpYyBzdGFuZGFyZCBNYXJrZG93biBpbWFnZSBsaW5rcyB0aGF0IG1pZ2h0IG5vdCBiZSBhc3NvY2lhdGVkIHdpdGggb3VyIGltYWdlc1xyXG4gICAgICAvLyBUaGlzIGlzIGVzcGVjaWFsbHkgaW1wb3J0YW50IGZvciBNaXN0cmFsIE9DUiByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGdlbmVyaWNNYXJrZG93blBhdHRlcm4gPSAvIVxcWyguKj8pXFxdXFwoKC4qPylcXCkvZztcclxuICAgICAgY29uc3QgcHJvY2Vzc2VkSW1hZ2VJZHMgPSBuZXcgU2V0KCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBtYXAgb2YgaW1hZ2UgcGF0aHMgZm9yIHF1aWNrIGxvb2t1cFxyXG4gICAgICBjb25zdCBpbWFnZVBhdGhzID0gbmV3IE1hcCgpO1xyXG4gICAgICBpbWFnZXMuZm9yRWFjaChpbWFnZSA9PiB7XHJcbiAgICAgICAgaWYgKGltYWdlICYmIHR5cGVvZiBpbWFnZSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBpZiAoaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIC8vIFN0b3JlIGJvdGggdGhlIGZ1bGwgcGF0aCBhbmQgdGhlIGJhc2VuYW1lIGZvciBtYXRjaGluZ1xyXG4gICAgICAgICAgICBpbWFnZVBhdGhzLnNldChpbWFnZVBhdGgsIGltYWdlUGF0aCk7XHJcbiAgICAgICAgICAgIGltYWdlUGF0aHMuc2V0KHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKSwgaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gUmVwbGFjZSBnZW5lcmljIE1hcmtkb3duIGltYWdlIGxpbmtzIHdpdGggT2JzaWRpYW4gZm9ybWF0IGlmIHdlIGhhdmUgYSBtYXRjaGluZyBpbWFnZVxyXG4gICAgICAvLyBCdXQgcHJlc2VydmUgVVJMIGltYWdlcyBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGdlbmVyaWNNYXJrZG93blBhdHRlcm4sIChtYXRjaCwgYWx0LCBzcmMpID0+IHtcclxuICAgICAgICAvLyBJZiBpdCdzIGEgVVJMLCBrZWVwIGl0IGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICAgIGlmIChpc1VybChzcmMpKSB7XHJcbiAgICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIGltYWdlIElEIGZyb20gdGhlIHNyY1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSBwYXRoLmJhc2VuYW1lKHNyYyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBhIG1hdGNoaW5nIGltYWdlLCB1c2UgdGhlIE9ic2lkaWFuIGZvcm1hdFxyXG4gICAgICAgIGlmIChpbWFnZVBhdGhzLmhhcyhpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmhhcyhzcmMpKSB7XHJcbiAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBpbWFnZVBhdGhzLmdldChpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmdldChzcmMpO1xyXG4gICAgICAgICAgcHJvY2Vzc2VkSW1hZ2VJZHMuYWRkKGltYWdlSWQpO1xyXG4gICAgICAgICAgcmV0dXJuIGAhW1ske2ltYWdlUGF0aH1dXWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE90aGVyd2lzZSwga2VlcCB0aGUgb3JpZ2luYWwgcmVmZXJlbmNlXHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIE5vdyBwcm9jZXNzIGVhY2ggaW1hZ2Ugc3BlY2lmaWNhbGx5XHJcbiAgICAgIGltYWdlcy5mb3JFYWNoKGltYWdlID0+IHtcclxuICAgICAgICAvLyBTa2lwIGludmFsaWQgaW1hZ2Ugb2JqZWN0c1xyXG4gICAgICAgIGlmICghaW1hZ2UgfHwgdHlwZW9mIGltYWdlICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3QgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGltYWdlKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIERldGVybWluZSB0aGUgaW1hZ2UgcGF0aCB0byB1c2VcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEltYWdlIG9iamVjdCBoYXMgbm8gcGF0aCwgbmFtZSwgb3Igc3JjOicsIGltYWdlKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBTa2lwIGlmIHdlIGFscmVhZHkgcHJvY2Vzc2VkIHRoaXMgaW1hZ2UgaW4gdGhlIGdlbmVyaWMgcGFzc1xyXG4gICAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIGlmIChwcm9jZXNzZWRJbWFnZUlkcy5oYXMoaW1hZ2VJZCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGaXJzdCByZXBsYWNlIHN0YW5kYXJkIG1hcmtkb3duIGltYWdlIHN5bnRheFxyXG4gICAgICAgICAgaWYgKGltYWdlLnNyYykge1xyXG4gICAgICAgICAgICAvLyBTa2lwIFVSTCBpbWFnZXMgLSBrZWVwIHRoZW0gaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2Uuc3JjKSkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duUGF0dGVybiA9IG5ldyBSZWdFeHAoYCFcXFxcW1teXFxcXF1dKlxcXFxdXFxcXCgke2VzY2FwZVJlZ0V4cChpbWFnZS5zcmMpfVteKV0qXFxcXClgLCAnZycpO1xyXG4gICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXJrZG93blBhdHRlcm4sIGAhW1ske2ltYWdlUGF0aH1dXWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2Ugc3RhbmRhcmQgbWFya2Rvd24gaW1hZ2Ugc3ludGF4IHdpdGggYW55IHBhdGhcclxuICAgICAgICAgIC8vIFNraXAgVVJMIGltYWdlcyAtIGtlZXAgdGhlbSBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2VQYXRoKSkge1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93bkFueVBhdHRlcm4gPSBuZXcgUmVnRXhwKGAhXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFwoJHtlc2NhcGVSZWdFeHAoaW1hZ2VQYXRoKX1bXildKlxcXFwpYCwgJ2cnKTtcclxuICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKG1hcmtkb3duQW55UGF0dGVybiwgYCFbWyR7aW1hZ2VQYXRofV1dYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2UgYW55IGV4aXN0aW5nIE9ic2lkaWFuIHN5bnRheCB0aGF0IGRvZXNuJ3QgbWF0Y2ggb3VyIGV4cGVjdGVkIGZvcm1hdFxyXG4gICAgICAgICAgY29uc3Qgb2JzaWRpYW5QYXR0ZXJuID0gbmV3IFJlZ0V4cChgIVxcXFxbXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFxdYCwgJ2cnKTtcclxuICAgICAgICAgIC8vIE9ubHkgcmVwbGFjZSBpZiBpdCdzIG5vdCBhbHJlYWR5IGluIHRoZSBjb3JyZWN0IGZvcm1hdCBhbmQgbm90IGEgVVJMXHJcbiAgICAgICAgICBpZiAoIWlzVXJsKGltYWdlUGF0aCkpIHtcclxuICAgICAgICAgICAgY29uc3QgY29ycmVjdE9ic2lkaWFuRm9ybWF0ID0gYCFbWyR7aW1hZ2VQYXRofV1dYDtcclxuICAgICAgICAgICAgaWYgKCF1cGRhdGVkQ29udGVudC5pbmNsdWRlcyhjb3JyZWN0T2JzaWRpYW5Gb3JtYXQpKSB7XHJcbiAgICAgICAgICAgICAgLy8gRmluZCBhbGwgT2JzaWRpYW4gaW1hZ2UgcmVmZXJlbmNlc1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSB1cGRhdGVkQ29udGVudC5tYXRjaChvYnNpZGlhblBhdHRlcm4pO1xyXG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBSZXBsYWNlIG9ubHkgdGhvc2UgdGhhdCBjb250YWluIHBhcnRzIG9mIG91ciBpbWFnZSBwYXRoXHJcbiAgICAgICAgICAgICAgICBtYXRjaGVzLmZvckVhY2gobWF0Y2ggPT4ge1xyXG4gICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHRoZSBwYXRoIGZyb20gdGhlIG1hdGNoXHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoUGF0aCA9IG1hdGNoLnN1YnN0cmluZygzLCBtYXRjaC5sZW5ndGggLSAyKTtcclxuICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgbWF0Y2ggaXMgcmVsYXRlZCB0byBvdXIgaW1hZ2VcclxuICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoUGF0aC5pbmNsdWRlcyhwYXRoLmJhc2VuYW1lKGltYWdlUGF0aCwgcGF0aC5leHRuYW1lKGltYWdlUGF0aCkpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXRjaCwgY29ycmVjdE9ic2lkaWFuRm9ybWF0KTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoaW1hZ2VFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gRXJyb3IgcHJvY2Vzc2luZyBpbWFnZSByZWZlcmVuY2U6YCwgaW1hZ2VFcnJvcik7XHJcbiAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG5leHQgaW1hZ2VcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gRmluYWxseSwgcmVtb3ZlIGFueSBcIkV4dHJhY3RlZCBJbWFnZXNcIiBzZWN0aW9uIHRoYXQgbWlnaHQgaGF2ZSBiZWVuIGFkZGVkXHJcbiAgICAgIGNvbnN0IGV4dHJhY3RlZEltYWdlc1BhdHRlcm4gPSAvXFxuXFxuIyMgRXh0cmFjdGVkIEltYWdlc1xcblxcbig/OiFcXFtcXFtbXlxcXV0rXFxdXFxdXFxuXFxuKSovZztcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGV4dHJhY3RlZEltYWdlc1BhdHRlcm4sICcnKTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGVycm9yKTtcclxuICAgICAgLy8gUmV0dXJuIG9yaWdpbmFsIGNvbnRlbnQgb24gZXJyb3JcclxuICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHVwZGF0ZWRDb250ZW50O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2F2ZXMgY29udmVyc2lvbiByZXN1bHQgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucyBmb3Igc2F2aW5nIHRoZSBjb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLmNvbnRlbnQgLSBUaGUgY29udGVudCB0byBzYXZlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm1ldGFkYXRhPXt9XSAtIE1ldGFkYXRhIHRvIGluY2x1ZGUgaW4gdGhlIGZyb250bWF0dGVyXHJcbiAgICogQHBhcmFtIHtBcnJheX0gW29wdGlvbnMuaW1hZ2VzPVtdXSAtIEFycmF5IG9mIGltYWdlIG9iamVjdHMgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IFtvcHRpb25zLmZpbGVzPVtdXSAtIEFycmF5IG9mIGFkZGl0aW9uYWwgZmlsZXMgdG8gc2F2ZSAoZm9yIG11bHRpLWZpbGUgY29udmVyc2lvbnMpXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMubmFtZSAtIEJhc2UgbmFtZSBmb3IgdGhlIG91dHB1dCBmaWxlL2RpcmVjdG9yeVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnR5cGUgLSBUeXBlIG9mIGNvbnRlbnQgKGUuZy4sICdwZGYnLCAndXJsJywgZXRjLilcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMub3V0cHV0RGlyXSAtIEN1c3RvbSBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm9wdGlvbnM9e31dIC0gQWRkaXRpb25hbCBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gUmVzdWx0IG9mIHRoZSBzYXZlIG9wZXJhdGlvblxyXG4gICAqL1xyXG4gIGFzeW5jIHNhdmVDb252ZXJzaW9uUmVzdWx0KHsgY29udGVudCwgbWV0YWRhdGEgPSB7fSwgaW1hZ2VzID0gW10sIGZpbGVzID0gW10sIG5hbWUsIHR5cGUsIGZpbGVUeXBlLCBvdXRwdXREaXIsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+UhCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFNhdmluZyBjb252ZXJzaW9uIHJlc3VsdCBmb3IgJHtuYW1lfSAoJHt0eXBlIHx8IGZpbGVUeXBlfSlgKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgcGFyYW1ldGVyc1xyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIGNvbnRlbnQgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29udGVudCBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFuYW1lKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG5hbWUgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTmFtZSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0eXBlICYmICFmaWxlVHlwZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyB0eXBlIG9yIGZpbGVUeXBlIHByb3ZpZGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb3IgZmlsZVR5cGUgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24gcmVzdWx0Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBmaWxlVHlwZSBhcyBmYWxsYmFjayBmb3IgdHlwZSBpZiB0eXBlIGlzIG5vdCBwcm92aWRlZFxyXG4gICAgY29uc3QgY29udGVudFR5cGUgPSB0eXBlIHx8IGZpbGVUeXBlO1xyXG4gICAgXHJcbiAgICBpZiAoIW91dHB1dERpcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBvdXRwdXQgZGlyZWN0b3J5IHByb3ZpZGVkIScpO1xyXG4gICAgICBjb25zb2xlLmxvZygn4pqg77iPIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gVXNpbmcgZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBwcm92aWRlZCBvdXRwdXQgZGlyZWN0b3J5IG9yIGZhbGwgYmFjayB0byBkZWZhdWx0XHJcbiAgICBjb25zdCBiYXNlT3V0cHV0RGlyID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgIFxyXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHdlIHNob3VsZCBjcmVhdGUgYSBzdWJkaXJlY3RvcnlcclxuICAgIGNvbnN0IHVzZXJQcm92aWRlZE91dHB1dERpciA9ICEhb3V0cHV0RGlyO1xyXG4gICAgY29uc3QgY3JlYXRlU3ViZGlyZWN0b3J5ID0gdXNlclByb3ZpZGVkT3V0cHV0RGlyID8gZmFsc2UgOiBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAob3B0aW9ucy5jcmVhdGVTdWJkaXJlY3RvcnkgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuY3JlYXRlU3ViZGlyZWN0b3J5IDogdHJ1ZSk7XHJcbiAgIFxyXG4gICAvLyBHZW5lcmF0ZSBhcHByb3ByaWF0ZSBmaWxlbmFtZSBiYXNlZCBvbiB0eXBlIGFuZCBtZXRhZGF0YVxyXG4gICBjb25zdCBmaWxlbmFtZSA9IGdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZShuYW1lLCBjb250ZW50VHlwZSwgbWV0YWRhdGEpO1xyXG4gICBcclxuICAgLy8gRGV0ZXJtaW5lIFVSTCBzdGF0dXMgZm9yIHBhdGggdmFsaWRhdGlvblxyXG4gICBjb25zdCBpc1VybCA9IGNvbnRlbnRUeXBlID09PSAndXJsJyB8fCBjb250ZW50VHlwZSA9PT0gJ3BhcmVudHVybCc7XHJcblxyXG4gICAgLy8gR2V0IHRoZSBiYXNlIG5hbWUgd2l0aG91dCBleHRlbnNpb24gYW5kIGVuc3VyZSBpdCdzIHZhbGlkIGZvciB0aGUgZmlsZSBzeXN0ZW1cclxuICAgIGNvbnN0IGJhc2VOYW1lID0gZ2V0QmFzZW5hbWUoZmlsZW5hbWUpLnJlcGxhY2UoL1s8PjpcIi9cXFxcfD8qXSsvZywgJ18nKS5yZXBsYWNlKC9cXHMrL2csICdfJyk7XHJcbiAgICBjb25zdCBvdXRwdXRCYXNlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/IFxyXG4gICAgICBwYXRoLmpvaW4oYmFzZU91dHB1dERpciwgYCR7YmFzZU5hbWV9XyR7RGF0ZS5ub3coKX1gKSA6IFxyXG4gICAgICBiYXNlT3V0cHV0RGlyO1xyXG5cclxuICAgIGNvbnNvbGUubG9nKGDwn5OBIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gR2VuZXJhdGVkIG91dHB1dCBwYXRoOiAke291dHB1dEJhc2VQYXRofWApO1xyXG5cclxuICAgIC8vIENyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5IHdpdGggVVJMIGF3YXJlbmVzc1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShvdXRwdXRCYXNlUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgY29uc29sZS5sb2coYOKchSBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIENyZWF0ZWQgb3V0cHV0IGRpcmVjdG9yeTogJHtvdXRwdXRCYXNlUGF0aH1gKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIEZhaWxlZCB0byBjcmVhdGUgb3V0cHV0IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgb3V0cHV0IGRpcmVjdG9yeTogJHtlcnJvci5tZXNzYWdlfWApO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENyZWF0ZSBpbWFnZXMgZGlyZWN0b3J5IGlmIHdlIGhhdmUgaW1hZ2VzXHJcbiAgICBpZiAoaW1hZ2VzICYmIGltYWdlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIC8vIEdyb3VwIGltYWdlcyBieSB0aGVpciBkaXJlY3RvcnkgcGF0aHNcclxuICAgICAgY29uc3QgaW1hZ2VzQnlEaXIgPSBuZXcgTWFwKCk7XHJcbiAgICAgIFxyXG4gICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIGltYWdlcykge1xyXG4gICAgICAgIGlmICghaW1hZ2UgfHwgIWltYWdlLnBhdGgpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIEludmFsaWQgaW1hZ2Ugb2JqZWN0IG9yIG1pc3NpbmcgcGF0aDpgLCBpbWFnZSk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gRXh0cmFjdCB0aGUgZGlyZWN0b3J5IHBhcnQgZnJvbSB0aGUgaW1hZ2UgcGF0aFxyXG4gICAgICAgIGNvbnN0IGRpclBhdGggPSBwYXRoLmRpcm5hbWUoaW1hZ2UucGF0aCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgaWYgKCFpbWFnZXNCeURpci5oYXMoZGlyUGF0aCkpIHtcclxuICAgICAgICAgIGltYWdlc0J5RGlyLnNldChkaXJQYXRoLCBbXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIGltYWdlc0J5RGlyLmdldChkaXJQYXRoKS5wdXNoKGltYWdlKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGVhY2ggdW5pcXVlIGRpcmVjdG9yeSBhbmQgc2F2ZSBpdHMgaW1hZ2VzXHJcbiAgICAgIGZvciAoY29uc3QgW2RpclBhdGgsIGRpckltYWdlc10gb2YgaW1hZ2VzQnlEaXIuZW50cmllcygpKSB7XHJcbiAgICAgICAgY29uc3QgZnVsbERpclBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGRpclBhdGgpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKGDwn5OBIENyZWF0aW5nIGltYWdlcyBkaXJlY3Rvcnk6ICR7ZnVsbERpclBhdGh9YCk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShmdWxsRGlyUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTYXZlIGltYWdlcyB0byB0aGVpciByZXNwZWN0aXZlIGRpcmVjdG9yaWVzXHJcbiAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBkaXJJbWFnZXMpIHtcclxuICAgICAgICAgIGlmIChpbWFnZSAmJiBpbWFnZS5kYXRhKSB7XHJcbiAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gcGF0aC5qb2luKG91dHB1dEJhc2VQYXRoLCBpbWFnZS5wYXRoKTtcclxuICAgICAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBTYXZpbmcgaW1hZ2U6ICR7aW1hZ2VQYXRofWApO1xyXG4gICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIC8vIEVuc3VyZSB0aGUgaW1hZ2UgZGF0YSBpcyBpbiB0aGUgcmlnaHQgZm9ybWF0XHJcbiAgICAgICAgICAgICAgY29uc3QgaW1hZ2VEYXRhID0gQnVmZmVyLmlzQnVmZmVyKGltYWdlLmRhdGEpIFxyXG4gICAgICAgICAgICAgICAgPyBpbWFnZS5kYXRhIFxyXG4gICAgICAgICAgICAgICAgOiAodHlwZW9mIGltYWdlLmRhdGEgPT09ICdzdHJpbmcnICYmIGltYWdlLmRhdGEuc3RhcnRzV2l0aCgnZGF0YTonKSlcclxuICAgICAgICAgICAgICAgICAgPyBCdWZmZXIuZnJvbShpbWFnZS5kYXRhLnNwbGl0KCcsJylbMV0sICdiYXNlNjQnKVxyXG4gICAgICAgICAgICAgICAgICA6IEJ1ZmZlci5mcm9tKGltYWdlLmRhdGEsICdiYXNlNjQnKTtcclxuICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLndyaXRlRmlsZShpbWFnZVBhdGgsIGltYWdlRGF0YSwgbnVsbCwgeyBpc1VybCB9KTtcclxuICAgICAgICAgICAgfSBjYXRjaCAoaW1hZ2VFcnJvcikge1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gc2F2ZSBpbWFnZTogJHtpbWFnZS5wYXRofWAsIGltYWdlRXJyb3IpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGltYWdlIG9iamVjdDpgLCBpbWFnZSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRGV0ZXJtaW5lIG1haW4gZmlsZSBwYXRoXHJcbiAgICBjb25zdCBtYWluRmlsZVBhdGggPSBjcmVhdGVTdWJkaXJlY3RvcnkgPyBcclxuICAgICAgcGF0aC5qb2luKG91dHB1dEJhc2VQYXRoLCAnZG9jdW1lbnQubWQnKSA6IFxyXG4gICAgICBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGAke2Jhc2VOYW1lfS5tZGApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBpbWFnZSByZWZlcmVuY2VzIHRvIHVzZSBPYnNpZGlhbiBmb3JtYXRcclxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVJbWFnZVJlZmVyZW5jZXMoY29udGVudCwgaW1hZ2VzKTtcclxuXHJcbiAgICAvLyBDbGVhbiBtZXRhZGF0YSBmaWVsZHMgYW5kIGNyZWF0ZSBtZXRhZGF0YSBvYmplY3RcclxuICAgIGNvbnN0IGZ1bGxNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsIC8vIEVuc3VyZSBmaWxlVHlwZSBpcyBpbmNsdWRlZCBpbiBtZXRhZGF0YVxyXG4gICAgICBjb252ZXJ0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgLi4ubWV0YWRhdGFcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgYW5kIG1lcmdlIGZyb250bWF0dGVyIGlmIGl0IGV4aXN0c1xyXG4gICAgY29uc3QgeyBtZXRhZGF0YTogZXhpc3RpbmdNZXRhZGF0YSwgY29udGVudDogY29udGVudFdpdGhvdXRGcm9udG1hdHRlciB9ID0gZXh0cmFjdEZyb250bWF0dGVyKHVwZGF0ZWRDb250ZW50KTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5OdIEV4dHJhY3RlZCBleGlzdGluZyBmcm9udG1hdHRlcjonLCBleGlzdGluZ01ldGFkYXRhKTtcclxuICAgIFxyXG4gICAgLy8gTWVyZ2UgbWV0YWRhdGEgdXNpbmcgc2hhcmVkIHV0aWxpdHlcclxuICAgIGNvbnN0IG1lcmdlZE1ldGFkYXRhID0gbWVyZ2VNZXRhZGF0YShleGlzdGluZ01ldGFkYXRhLCBmdWxsTWV0YWRhdGEsIHtcclxuICAgICAgdHlwZTogZnVsbE1ldGFkYXRhLnR5cGUsIC8vIEVuc3VyZSB0eXBlIGZyb20gZnVsbE1ldGFkYXRhIHRha2VzIHByZWNlZGVuY2VcclxuICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgLy8gQWx3YXlzIHVzZSBjdXJyZW50IHRpbWVzdGFtcFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEZvcm1hdCBhbmQgY29tYmluZSB3aXRoIGNvbnRlbnRcclxuICAgIGNvbnN0IGZyb250bWF0dGVyID0gZm9ybWF0TWV0YWRhdGEobWVyZ2VkTWV0YWRhdGEpO1xyXG4gICAgY29uc3QgZnVsbENvbnRlbnQgPSBmcm9udG1hdHRlciArIGNvbnRlbnRXaXRob3V0RnJvbnRtYXR0ZXI7XHJcblxyXG4gICAgLy8gU2F2ZSB0aGUgbWFya2Rvd24gY29udGVudCB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUobWFpbkZpbGVQYXRoLCBmdWxsQ29udGVudCwgJ3V0ZjgnLCB7IGlzVXJsIH0pO1xyXG5cclxuICAgIC8vIEhhbmRsZSBhZGRpdGlvbmFsIGZpbGVzIGlmIHByb3ZpZGVkIChmb3IgbXVsdGktZmlsZSBjb252ZXJzaW9ucyBsaWtlIHBhcmVudHVybClcclxuICAgIGlmIChmaWxlcyAmJiBBcnJheS5pc0FycmF5KGZpbGVzKSAmJiBmaWxlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gUHJvY2Vzc2luZyAke2ZpbGVzLmxlbmd0aH0gYWRkaXRpb25hbCBmaWxlc2ApO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgaWYgKCFmaWxlIHx8ICFmaWxlLm5hbWUgfHwgIWZpbGUuY29udGVudCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBmaWxlIG9iamVjdDpgLCBmaWxlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRW5zdXJlIHRoZSBkaXJlY3RvcnkgZXhpc3RzXHJcbiAgICAgICAgICBjb25zdCBmaWxlRGlyUGF0aCA9IHBhdGguZGlybmFtZShwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSkpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShmaWxlRGlyUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gU2F2ZSB0aGUgZmlsZVxyXG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBTYXZpbmcgYWRkaXRpb25hbCBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgd2UgbmVlZCB0byBhZGQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgIGxldCBmaWxlQ29udGVudCA9IGZpbGUuY29udGVudDtcclxuICAgICAgICAgIGlmIChmaWxlLnR5cGUgPT09ICd0ZXh0JyAmJiAhZmlsZUNvbnRlbnQudHJpbSgpLnN0YXJ0c1dpdGgoJy0tLScpKSB7XHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBtZXRhZGF0YSBmb3IgdGhpcyBmaWxlXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICAgICAgICAgIHR5cGU6IGZpbGUudHlwZSB8fCAndGV4dCcsXHJcbiAgICAgICAgICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICAgICAgLi4uKGZpbGUubWV0YWRhdGEgfHwge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGZyb250bWF0dGVyXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVGcm9udG1hdHRlciA9IGZvcm1hdE1ldGFkYXRhKGZpbGVNZXRhZGF0YSk7XHJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ID0gZmlsZUZyb250bWF0dGVyICsgZmlsZUNvbnRlbnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50LCAndXRmOCcsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZmlsZUVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgZmlsZTogJHtmaWxlLm5hbWV9YCwgZmlsZUVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgdGhlIHJlc3VsdCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+SviBDb252ZXJzaW9uIHJlc3VsdCBzYXZlZDonLCB7XHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoLFxyXG4gICAgICBoYXNJbWFnZXM6IGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCxcclxuICAgICAgaW1hZ2VDb3VudDogaW1hZ2VzID8gaW1hZ2VzLmxlbmd0aCA6IDAsXHJcbiAgICAgIGFkZGl0aW9uYWxGaWxlczogZmlsZXMgPyBmaWxlcy5sZW5ndGggOiAwLFxyXG4gICAgICBjb250ZW50TGVuZ3RoOiBmdWxsQ29udGVudC5sZW5ndGhcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpXHJcbiAgICBjb25zdCBpc0RhdGFGaWxlID0gY29udGVudFR5cGUgPT09ICdjc3YnIHx8IGNvbnRlbnRUeXBlID09PSAneGxzeCcgfHxcclxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVUeXBlID09PSAnY3N2JyB8fCBmaWxlVHlwZSA9PT0gJ3hsc3gnO1xyXG4gICAgaWYgKGlzRGF0YUZpbGUpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGU6ICR7dHlwZX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGFsbCByZXF1aXJlZCBwcm9wZXJ0aWVzIGZvciBkYXRhIGZpbGVzXHJcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7XHJcbiAgICAgICAgbWV0YWRhdGEuZm9ybWF0ID0gdHlwZTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKCFtZXRhZGF0YS50eXBlKSB7XHJcbiAgICAgICAgbWV0YWRhdGEudHlwZSA9ICdzcHJlYWRzaGVldCc7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBhZGRpdGlvbmFsIGxvZ2dpbmcgZm9yIGRhdGEgZmlsZXNcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBEYXRhIGZpbGUgbWV0YWRhdGE6YCwgbWV0YWRhdGEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgd2UgaGF2ZSBhIHZhbGlkIG91dHB1dCBwYXRoXHJcbiAgICBpZiAoIW91dHB1dEJhc2VQYXRoKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG91dHB1dCBwYXRoIGdlbmVyYXRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgb3V0cHV0IHBhdGgnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gUmV0dXJuIHN0YW5kYXJkaXplZCByZXN1bHQgd2l0aCBndWFyYW50ZWVkIG91dHB1dFBhdGhcclxuICAgIGNvbnN0IHJlc3VsdCA9IHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGgsXHJcbiAgICAgIG1ldGFkYXRhOiBmdWxsTWV0YWRhdGFcclxuICAgIH07XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTdWNjZXNzZnVsbHkgc2F2ZWQgY29udmVyc2lvbiByZXN1bHQ6YCwge1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsXHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU1FLGlCQUFpQixHQUFHRixPQUFPLENBQUMscUJBQXFCLENBQUM7QUFDeEQsTUFBTTtFQUFFRyxjQUFjO0VBQUVDLGFBQWE7RUFBRUMsa0JBQWtCO0VBQUVDO0FBQWMsQ0FBQyxHQUFHTixPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDekcsTUFBTTtFQUFFTyxzQkFBc0I7RUFBRUMsV0FBVztFQUFFQztBQUFvQixDQUFDLEdBQUdULE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQzs7QUFFOUY7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNVLDJCQUEyQkEsQ0FBQ0MsWUFBWSxFQUFFQyxJQUFJLEVBQUVDLFFBQVEsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUN0RSxJQUFJRCxJQUFJLEtBQUssS0FBSyxJQUFJQyxRQUFRLENBQUNDLFVBQVUsRUFBRTtJQUN6QyxPQUFPTCxtQkFBbUIsQ0FBQ0ksUUFBUSxDQUFDQyxVQUFVLENBQUM7RUFDakQ7O0VBRUE7RUFDQSxPQUFPUCxzQkFBc0IsQ0FBQ0ksWUFBWSxDQUFDO0FBQzdDOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSxTQUFTSSxZQUFZQSxDQUFDQyxNQUFNLEVB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