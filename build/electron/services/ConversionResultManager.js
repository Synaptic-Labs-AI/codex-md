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
  console.log(`🔄 [ConversionResultManager] Generating filename for: ${originalName} (${type})`);

  // For URL conversions, generate from the source URL if available
  if (type === 'url' && metadata.source_url) {
    return generateUrlFilename(metadata.source_url);
  }

  // For Excel and data files, prioritize originalFileName from metadata
  if (type === 'xlsx' || type === 'csv') {
    // Use the metadata.originalFileName if available (added in our fix to converters)
    if (metadata.originalFileName) {
      console.log(`📊 [ConversionResultManager] Using originalFileName from metadata: ${metadata.originalFileName}`);
      console.log(`📊 [ConversionResultManager] Available metadata keys: ${Object.keys(metadata).join(', ')}`);
      return cleanTemporaryFilename(metadata.originalFileName);
    }

    // Log if originalFileName is missing for spreadsheet files
    console.warn(`⚠️ [ConversionResultManager] No originalFileName found in metadata for ${type} file. Metadata keys: ${Object.keys(metadata).join(', ')}`);
    console.warn(`⚠️ [ConversionResultManager] Using fallback: ${originalName}`);
  }

  // For all other files, clean the original name
  const cleanedName = cleanTemporaryFilename(originalName);
  console.log(`📄 [ConversionResultManager] Generated filename: ${cleanedName}`);
  return cleanedName;
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
    // No need to replace spaces with underscores or make other changes since cleanTemporaryFilename already did that
    const baseName = getBasename(filename);
    console.log(`📝 [ConversionResultManager] Using base name: ${baseName}`);

    // For output directory path, use the base name but without timestamp suffix in the directory name
    // The timestamp is only added to prevent collisions
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

    // Determine main file path - use baseName instead of hardcoded 'document.md'
    // This ensures the original filename is preserved even when creating a subdirectory
    const mainFilePath = createSubdirectory ? path.join(outputBasePath, `${baseName}.md`) : path.join(outputBasePath, `${baseName}.md`);

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsImluc3RhbmNlIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJleHRyYWN0RnJvbnRtYXR0ZXIiLCJtZXJnZU1ldGFkYXRhIiwiY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSIsImdldEJhc2VuYW1lIiwiZ2VuZXJhdGVVcmxGaWxlbmFtZSIsImdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZSIsIm9yaWdpbmFsTmFtZSIsInR5cGUiLCJtZXRhZGF0YSIsImNvbnNvbGUiLCJsb2ciLCJzb3VyY2VfdXJsIiwib3JpZ2luYWxGaWxlTmFtZSIsIk9iamVjdCIsImtleXMiLCJqb2luIiwid2FybiIsImNsZWFuZWROYW1lIiwiZXNjYXBlUmVnRXhwIiwic3RyaW5nIiwidW5kZWZpbmVkIiwicmVwbGFjZSIsImVycm9yIiwiaXNVcmwiLCJzdGFydHNXaXRoIiwiQ29udmVyc2lvblJlc3VsdE1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVTeXN0ZW0iLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsInVwZGF0ZUltYWdlUmVmZXJlbmNlcyIsImNvbnRlbnQiLCJpbWFnZXMiLCJBcnJheSIsImlzQXJyYXkiLCJsZW5ndGgiLCJ1cGRhdGVkQ29udGVudCIsImdlbmVyaWNNYXJrZG93blBhdHRlcm4iLCJwcm9jZXNzZWRJbWFnZUlkcyIsIlNldCIsImltYWdlUGF0aHMiLCJNYXAiLCJmb3JFYWNoIiwiaW1hZ2UiLCJpbWFnZVBhdGgiLCJuYW1lIiwic3JjIiwic2V0IiwiYmFzZW5hbWUiLCJtYXRjaCIsImFsdCIsImltYWdlSWQiLCJoYXMiLCJnZXQiLCJhZGQiLCJtYXJrZG93blBhdHRlcm4iLCJSZWdFeHAiLCJtYXJrZG93bkFueVBhdHRlcm4iLCJvYnNpZGlhblBhdHRlcm4iLCJjb3JyZWN0T2JzaWRpYW5Gb3JtYXQiLCJpbmNsdWRlcyIsIm1hdGNoZXMiLCJtYXRjaFBhdGgiLCJzdWJzdHJpbmciLCJleHRuYW1lIiwiaW1hZ2VFcnJvciIsImV4dHJhY3RlZEltYWdlc1BhdHRlcm4iLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImZpbGVzIiwiZmlsZVR5cGUiLCJvdXRwdXREaXIiLCJvcHRpb25zIiwiRXJyb3IiLCJjb250ZW50VHlwZSIsImJhc2VPdXRwdXREaXIiLCJ1c2VyUHJvdmlkZWRPdXRwdXREaXIiLCJjcmVhdGVTdWJkaXJlY3RvcnkiLCJmaWxlbmFtZSIsImJhc2VOYW1lIiwib3V0cHV0QmFzZVBhdGgiLCJEYXRlIiwibm93IiwiY3JlYXRlRGlyZWN0b3J5IiwibWVzc2FnZSIsImltYWdlc0J5RGlyIiwiZGlyUGF0aCIsImRpcm5hbWUiLCJwdXNoIiwiZGlySW1hZ2VzIiwiZW50cmllcyIsImZ1bGxEaXJQYXRoIiwiZGF0YSIsImltYWdlRGF0YSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZnJvbSIsInNwbGl0Iiwid3JpdGVGaWxlIiwibWFpbkZpbGVQYXRoIiwiZnVsbE1ldGFkYXRhIiwiY29udmVydGVkIiwidG9JU09TdHJpbmciLCJleGlzdGluZ01ldGFkYXRhIiwiY29udGVudFdpdGhvdXRGcm9udG1hdHRlciIsIm1lcmdlZE1ldGFkYXRhIiwiZnJvbnRtYXR0ZXIiLCJmdWxsQ29udGVudCIsImZpbGUiLCJmaWxlRGlyUGF0aCIsImZpbGVQYXRoIiwiZmlsZUNvbnRlbnQiLCJ0cmltIiwiZmlsZU1ldGFkYXRhIiwiZmlsZUZyb250bWF0dGVyIiwiZmlsZUVycm9yIiwib3V0cHV0UGF0aCIsIm1haW5GaWxlIiwiaGFzSW1hZ2VzIiwiaW1hZ2VDb3VudCIsImFkZGl0aW9uYWxGaWxlcyIsImNvbnRlbnRMZW5ndGgiLCJpc0RhdGFGaWxlIiwiZm9ybWF0IiwicmVzdWx0Iiwic3VjY2VzcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvQ29udmVyc2lvblJlc3VsdE1hbmFnZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyLmpzXHJcbiAqIFxyXG4gKiBIYW5kbGVzIHNhdmluZyBjb252ZXJzaW9uIHJlc3VsdHMgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZy5cclxuICogTWFuYWdlcyBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZSwgaW1hZ2Ugc2F2aW5nLCBhbmQgbWV0YWRhdGEgZm9ybWF0dGluZy5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBzYXZpbmcgY29udmVyc2lvbiByZXN1bHRzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIHN5c3RlbSBvcGVyYXRpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL2FkYXB0ZXJzL21ldGFkYXRhRXh0cmFjdG9yQWRhcHRlci5qczogVXNlZCBmb3IgbWV0YWRhdGEgZm9ybWF0dGluZ1xyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IGluc3RhbmNlOiBGaWxlU3lzdGVtU2VydmljZSB9ID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpOyAvLyBJbXBvcnQgaW5zdGFuY2VcclxuY29uc3QgeyBmb3JtYXRNZXRhZGF0YSwgY2xlYW5NZXRhZGF0YSwgZXh0cmFjdEZyb250bWF0dGVyLCBtZXJnZU1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi91dGlscy9tYXJrZG93bicpO1xyXG5jb25zdCB7IGNsZWFuVGVtcG9yYXJ5RmlsZW5hbWUsIGdldEJhc2VuYW1lLCBnZW5lcmF0ZVVybEZpbGVuYW1lIH0gPSByZXF1aXJlKCcuLi91dGlscy9maWxlcycpO1xyXG5cclxuLyoqXHJcbiAqIEdlbmVyYXRlIGFwcHJvcHJpYXRlIGZpbGVuYW1lIGJhc2VkIG9uIGNvbnZlcnNpb24gdHlwZSBhbmQgbWV0YWRhdGFcclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtzdHJpbmd9IG9yaWdpbmFsTmFtZSAtIE9yaWdpbmFsIGZpbGVuYW1lIG9yIFVSTFxyXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFR5cGUgb2YgY29udmVyc2lvbiAoZS5nLiwgJ3VybCcsICdwZGYnKVxyXG4gKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBNZXRhZGF0YSBmcm9tIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGFwcHJvcHJpYXRlIGZpbGVuYW1lXHJcbiAqL1xyXG5mdW5jdGlvbiBnZW5lcmF0ZUFwcHJvcHJpYXRlRmlsZW5hbWUob3JpZ2luYWxOYW1lLCB0eXBlLCBtZXRhZGF0YSA9IHt9KSB7XHJcbiAgY29uc29sZS5sb2coYPCflIQgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0aW5nIGZpbGVuYW1lIGZvcjogJHtvcmlnaW5hbE5hbWV9ICgke3R5cGV9KWApO1xyXG5cclxuICAvLyBGb3IgVVJMIGNvbnZlcnNpb25zLCBnZW5lcmF0ZSBmcm9tIHRoZSBzb3VyY2UgVVJMIGlmIGF2YWlsYWJsZVxyXG4gIGlmICh0eXBlID09PSAndXJsJyAmJiBtZXRhZGF0YS5zb3VyY2VfdXJsKSB7XHJcbiAgICByZXR1cm4gZ2VuZXJhdGVVcmxGaWxlbmFtZShtZXRhZGF0YS5zb3VyY2VfdXJsKTtcclxuICB9XHJcblxyXG4gIC8vIEZvciBFeGNlbCBhbmQgZGF0YSBmaWxlcywgcHJpb3JpdGl6ZSBvcmlnaW5hbEZpbGVOYW1lIGZyb20gbWV0YWRhdGFcclxuICBpZiAodHlwZSA9PT0gJ3hsc3gnIHx8IHR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAvLyBVc2UgdGhlIG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUgaWYgYXZhaWxhYmxlIChhZGRlZCBpbiBvdXIgZml4IHRvIGNvbnZlcnRlcnMpXHJcbiAgICBpZiAobWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIG9yaWdpbmFsRmlsZU5hbWUgZnJvbSBtZXRhZGF0YTogJHttZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lfWApO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIEF2YWlsYWJsZSBtZXRhZGF0YSBrZXlzOiAke09iamVjdC5rZXlzKG1ldGFkYXRhKS5qb2luKCcsICcpfWApO1xyXG4gICAgICByZXR1cm4gY2xlYW5UZW1wb3JhcnlGaWxlbmFtZShtZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgaWYgb3JpZ2luYWxGaWxlTmFtZSBpcyBtaXNzaW5nIGZvciBzcHJlYWRzaGVldCBmaWxlc1xyXG4gICAgY29uc29sZS53YXJuKGDimqDvuI8gW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBvcmlnaW5hbEZpbGVOYW1lIGZvdW5kIGluIG1ldGFkYXRhIGZvciAke3R5cGV9IGZpbGUuIE1ldGFkYXRhIGtleXM6ICR7T2JqZWN0LmtleXMobWV0YWRhdGEpLmpvaW4oJywgJyl9YCk7XHJcbiAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIGZhbGxiYWNrOiAke29yaWdpbmFsTmFtZX1gKTtcclxuICB9XHJcblxyXG4gIC8vIEZvciBhbGwgb3RoZXIgZmlsZXMsIGNsZWFuIHRoZSBvcmlnaW5hbCBuYW1lXHJcbiAgY29uc3QgY2xlYW5lZE5hbWUgPSBjbGVhblRlbXBvcmFyeUZpbGVuYW1lKG9yaWdpbmFsTmFtZSk7XHJcbiAgY29uc29sZS5sb2coYPCfk4QgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0ZWQgZmlsZW5hbWU6ICR7Y2xlYW5lZE5hbWV9YCk7XHJcbiAgcmV0dXJuIGNsZWFuZWROYW1lO1xyXG59XHJcblxyXG4vKipcclxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGVzY2FwZSBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gcmVndWxhciBleHByZXNzaW9uc1xyXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gVGhlIHN0cmluZyB0byBlc2NhcGVcclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGVzY2FwZWQgc3RyaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyaW5nKSB7XHJcbiAgLy8gSGFuZGxlIG51bGwsIHVuZGVmaW5lZCwgb3Igbm9uLXN0cmluZyBpbnB1dHNcclxuICBpZiAoc3RyaW5nID09PSBudWxsIHx8IHN0cmluZyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSB7XHJcbiAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGlucHV0IHRvIGVzY2FwZVJlZ0V4cDogJHtzdHJpbmd9YCk7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBpbiBlc2NhcGVSZWdFeHA6YCwgZXJyb3IpO1xyXG4gICAgcmV0dXJuICcnO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBhIHBhdGggaXMgYSBVUkxcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBjaGVja1xyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGF0aCBpcyBhIFVSTFxyXG4gKi9cclxuZnVuY3Rpb24gaXNVcmwocGF0aCkge1xyXG4gIHJldHVybiB0eXBlb2YgcGF0aCA9PT0gJ3N0cmluZycgJiYgKHBhdGguc3RhcnRzV2l0aCgnaHR0cDovLycpIHx8IHBhdGguc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSk7XHJcbn1cclxuXHJcbmNsYXNzIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlO1xyXG4gICAgdGhpcy5kZWZhdWx0T3V0cHV0RGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY29udmVyc2lvbnMnKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIGluaXRpYWxpemVkIHdpdGggZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgaW1hZ2UgcmVmZXJlbmNlcyB0byB1c2UgT2JzaWRpYW4gZm9ybWF0XHJcbiAgICogQHByaXZhdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29udGVudCAtIFRoZSBjb250ZW50IHRvIHVwZGF0ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IGltYWdlcyAtIEFycmF5IG9mIGltYWdlIG9iamVjdHNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVcGRhdGVkIGNvbnRlbnQgd2l0aCBPYnNpZGlhbiBpbWFnZSByZWZlcmVuY2VzXHJcbiAgICovXHJcbiAgdXBkYXRlSW1hZ2VSZWZlcmVuY2VzKGNvbnRlbnQsIGltYWdlcykge1xyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXHJcbiAgICBpZiAoIWNvbnRlbnQgfHwgdHlwZW9mIGNvbnRlbnQgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEludmFsaWQgY29udGVudCBwcm92aWRlZCB0byB1cGRhdGVJbWFnZVJlZmVyZW5jZXMnKTtcclxuICAgICAgcmV0dXJuIGNvbnRlbnQgfHwgJyc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghaW1hZ2VzIHx8ICFBcnJheS5pc0FycmF5KGltYWdlcykgfHwgaW1hZ2VzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gY29udGVudDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gY29udGVudDtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRmlyc3QsIGhhbmRsZSBhbnkgZ2VuZXJpYyBzdGFuZGFyZCBNYXJrZG93biBpbWFnZSBsaW5rcyB0aGF0IG1pZ2h0IG5vdCBiZSBhc3NvY2lhdGVkIHdpdGggb3VyIGltYWdlc1xyXG4gICAgICAvLyBUaGlzIGlzIGVzcGVjaWFsbHkgaW1wb3J0YW50IGZvciBNaXN0cmFsIE9DUiByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGdlbmVyaWNNYXJrZG93blBhdHRlcm4gPSAvIVxcWyguKj8pXFxdXFwoKC4qPylcXCkvZztcclxuICAgICAgY29uc3QgcHJvY2Vzc2VkSW1hZ2VJZHMgPSBuZXcgU2V0KCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBtYXAgb2YgaW1hZ2UgcGF0aHMgZm9yIHF1aWNrIGxvb2t1cFxyXG4gICAgICBjb25zdCBpbWFnZVBhdGhzID0gbmV3IE1hcCgpO1xyXG4gICAgICBpbWFnZXMuZm9yRWFjaChpbWFnZSA9PiB7XHJcbiAgICAgICAgaWYgKGltYWdlICYmIHR5cGVvZiBpbWFnZSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBpZiAoaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIC8vIFN0b3JlIGJvdGggdGhlIGZ1bGwgcGF0aCBhbmQgdGhlIGJhc2VuYW1lIGZvciBtYXRjaGluZ1xyXG4gICAgICAgICAgICBpbWFnZVBhdGhzLnNldChpbWFnZVBhdGgsIGltYWdlUGF0aCk7XHJcbiAgICAgICAgICAgIGltYWdlUGF0aHMuc2V0KHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKSwgaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gUmVwbGFjZSBnZW5lcmljIE1hcmtkb3duIGltYWdlIGxpbmtzIHdpdGggT2JzaWRpYW4gZm9ybWF0IGlmIHdlIGhhdmUgYSBtYXRjaGluZyBpbWFnZVxyXG4gICAgICAvLyBCdXQgcHJlc2VydmUgVVJMIGltYWdlcyBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGdlbmVyaWNNYXJrZG93blBhdHRlcm4sIChtYXRjaCwgYWx0LCBzcmMpID0+IHtcclxuICAgICAgICAvLyBJZiBpdCdzIGEgVVJMLCBrZWVwIGl0IGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICAgIGlmIChpc1VybChzcmMpKSB7XHJcbiAgICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIGltYWdlIElEIGZyb20gdGhlIHNyY1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSBwYXRoLmJhc2VuYW1lKHNyYyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBhIG1hdGNoaW5nIGltYWdlLCB1c2UgdGhlIE9ic2lkaWFuIGZvcm1hdFxyXG4gICAgICAgIGlmIChpbWFnZVBhdGhzLmhhcyhpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmhhcyhzcmMpKSB7XHJcbiAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBpbWFnZVBhdGhzLmdldChpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmdldChzcmMpO1xyXG4gICAgICAgICAgcHJvY2Vzc2VkSW1hZ2VJZHMuYWRkKGltYWdlSWQpO1xyXG4gICAgICAgICAgcmV0dXJuIGAhW1ske2ltYWdlUGF0aH1dXWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE90aGVyd2lzZSwga2VlcCB0aGUgb3JpZ2luYWwgcmVmZXJlbmNlXHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIE5vdyBwcm9jZXNzIGVhY2ggaW1hZ2Ugc3BlY2lmaWNhbGx5XHJcbiAgICAgIGltYWdlcy5mb3JFYWNoKGltYWdlID0+IHtcclxuICAgICAgICAvLyBTa2lwIGludmFsaWQgaW1hZ2Ugb2JqZWN0c1xyXG4gICAgICAgIGlmICghaW1hZ2UgfHwgdHlwZW9mIGltYWdlICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3QgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGltYWdlKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIERldGVybWluZSB0aGUgaW1hZ2UgcGF0aCB0byB1c2VcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEltYWdlIG9iamVjdCBoYXMgbm8gcGF0aCwgbmFtZSwgb3Igc3JjOicsIGltYWdlKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBTa2lwIGlmIHdlIGFscmVhZHkgcHJvY2Vzc2VkIHRoaXMgaW1hZ2UgaW4gdGhlIGdlbmVyaWMgcGFzc1xyXG4gICAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIGlmIChwcm9jZXNzZWRJbWFnZUlkcy5oYXMoaW1hZ2VJZCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGaXJzdCByZXBsYWNlIHN0YW5kYXJkIG1hcmtkb3duIGltYWdlIHN5bnRheFxyXG4gICAgICAgICAgaWYgKGltYWdlLnNyYykge1xyXG4gICAgICAgICAgICAvLyBTa2lwIFVSTCBpbWFnZXMgLSBrZWVwIHRoZW0gaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2Uuc3JjKSkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duUGF0dGVybiA9IG5ldyBSZWdFeHAoYCFcXFxcW1teXFxcXF1dKlxcXFxdXFxcXCgke2VzY2FwZVJlZ0V4cChpbWFnZS5zcmMpfVteKV0qXFxcXClgLCAnZycpO1xyXG4gICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXJrZG93blBhdHRlcm4sIGAhW1ske2ltYWdlUGF0aH1dXWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2Ugc3RhbmRhcmQgbWFya2Rvd24gaW1hZ2Ugc3ludGF4IHdpdGggYW55IHBhdGhcclxuICAgICAgICAgIC8vIFNraXAgVVJMIGltYWdlcyAtIGtlZXAgdGhlbSBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2VQYXRoKSkge1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93bkFueVBhdHRlcm4gPSBuZXcgUmVnRXhwKGAhXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFwoJHtlc2NhcGVSZWdFeHAoaW1hZ2VQYXRoKX1bXildKlxcXFwpYCwgJ2cnKTtcclxuICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKG1hcmtkb3duQW55UGF0dGVybiwgYCFbWyR7aW1hZ2VQYXRofV1dYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2UgYW55IGV4aXN0aW5nIE9ic2lkaWFuIHN5bnRheCB0aGF0IGRvZXNuJ3QgbWF0Y2ggb3VyIGV4cGVjdGVkIGZvcm1hdFxyXG4gICAgICAgICAgY29uc3Qgb2JzaWRpYW5QYXR0ZXJuID0gbmV3IFJlZ0V4cChgIVxcXFxbXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFxdYCwgJ2cnKTtcclxuICAgICAgICAgIC8vIE9ubHkgcmVwbGFjZSBpZiBpdCdzIG5vdCBhbHJlYWR5IGluIHRoZSBjb3JyZWN0IGZvcm1hdCBhbmQgbm90IGEgVVJMXHJcbiAgICAgICAgICBpZiAoIWlzVXJsKGltYWdlUGF0aCkpIHtcclxuICAgICAgICAgICAgY29uc3QgY29ycmVjdE9ic2lkaWFuRm9ybWF0ID0gYCFbWyR7aW1hZ2VQYXRofV1dYDtcclxuICAgICAgICAgICAgaWYgKCF1cGRhdGVkQ29udGVudC5pbmNsdWRlcyhjb3JyZWN0T2JzaWRpYW5Gb3JtYXQpKSB7XHJcbiAgICAgICAgICAgICAgLy8gRmluZCBhbGwgT2JzaWRpYW4gaW1hZ2UgcmVmZXJlbmNlc1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSB1cGRhdGVkQ29udGVudC5tYXRjaChvYnNpZGlhblBhdHRlcm4pO1xyXG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBSZXBsYWNlIG9ubHkgdGhvc2UgdGhhdCBjb250YWluIHBhcnRzIG9mIG91ciBpbWFnZSBwYXRoXHJcbiAgICAgICAgICAgICAgICBtYXRjaGVzLmZvckVhY2gobWF0Y2ggPT4ge1xyXG4gICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHRoZSBwYXRoIGZyb20gdGhlIG1hdGNoXHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoUGF0aCA9IG1hdGNoLnN1YnN0cmluZygzLCBtYXRjaC5sZW5ndGggLSAyKTtcclxuICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgbWF0Y2ggaXMgcmVsYXRlZCB0byBvdXIgaW1hZ2VcclxuICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoUGF0aC5pbmNsdWRlcyhwYXRoLmJhc2VuYW1lKGltYWdlUGF0aCwgcGF0aC5leHRuYW1lKGltYWdlUGF0aCkpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXRjaCwgY29ycmVjdE9ic2lkaWFuRm9ybWF0KTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoaW1hZ2VFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gRXJyb3IgcHJvY2Vzc2luZyBpbWFnZSByZWZlcmVuY2U6YCwgaW1hZ2VFcnJvcik7XHJcbiAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG5leHQgaW1hZ2VcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gRmluYWxseSwgcmVtb3ZlIGFueSBcIkV4dHJhY3RlZCBJbWFnZXNcIiBzZWN0aW9uIHRoYXQgbWlnaHQgaGF2ZSBiZWVuIGFkZGVkXHJcbiAgICAgIGNvbnN0IGV4dHJhY3RlZEltYWdlc1BhdHRlcm4gPSAvXFxuXFxuIyMgRXh0cmFjdGVkIEltYWdlc1xcblxcbig/OiFcXFtcXFtbXlxcXV0rXFxdXFxdXFxuXFxuKSovZztcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGV4dHJhY3RlZEltYWdlc1BhdHRlcm4sICcnKTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGVycm9yKTtcclxuICAgICAgLy8gUmV0dXJuIG9yaWdpbmFsIGNvbnRlbnQgb24gZXJyb3JcclxuICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHVwZGF0ZWRDb250ZW50O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2F2ZXMgY29udmVyc2lvbiByZXN1bHQgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucyBmb3Igc2F2aW5nIHRoZSBjb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLmNvbnRlbnQgLSBUaGUgY29udGVudCB0byBzYXZlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm1ldGFkYXRhPXt9XSAtIE1ldGFkYXRhIHRvIGluY2x1ZGUgaW4gdGhlIGZyb250bWF0dGVyXHJcbiAgICogQHBhcmFtIHtBcnJheX0gW29wdGlvbnMuaW1hZ2VzPVtdXSAtIEFycmF5IG9mIGltYWdlIG9iamVjdHMgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IFtvcHRpb25zLmZpbGVzPVtdXSAtIEFycmF5IG9mIGFkZGl0aW9uYWwgZmlsZXMgdG8gc2F2ZSAoZm9yIG11bHRpLWZpbGUgY29udmVyc2lvbnMpXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMubmFtZSAtIEJhc2UgbmFtZSBmb3IgdGhlIG91dHB1dCBmaWxlL2RpcmVjdG9yeVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnR5cGUgLSBUeXBlIG9mIGNvbnRlbnQgKGUuZy4sICdwZGYnLCAndXJsJywgZXRjLilcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMub3V0cHV0RGlyXSAtIEN1c3RvbSBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm9wdGlvbnM9e31dIC0gQWRkaXRpb25hbCBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gUmVzdWx0IG9mIHRoZSBzYXZlIG9wZXJhdGlvblxyXG4gICAqL1xyXG4gIGFzeW5jIHNhdmVDb252ZXJzaW9uUmVzdWx0KHsgY29udGVudCwgbWV0YWRhdGEgPSB7fSwgaW1hZ2VzID0gW10sIGZpbGVzID0gW10sIG5hbWUsIHR5cGUsIGZpbGVUeXBlLCBvdXRwdXREaXIsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+UhCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFNhdmluZyBjb252ZXJzaW9uIHJlc3VsdCBmb3IgJHtuYW1lfSAoJHt0eXBlIHx8IGZpbGVUeXBlfSlgKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgcGFyYW1ldGVyc1xyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIGNvbnRlbnQgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29udGVudCBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFuYW1lKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG5hbWUgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTmFtZSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0eXBlICYmICFmaWxlVHlwZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyB0eXBlIG9yIGZpbGVUeXBlIHByb3ZpZGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb3IgZmlsZVR5cGUgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24gcmVzdWx0Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBmaWxlVHlwZSBhcyBmYWxsYmFjayBmb3IgdHlwZSBpZiB0eXBlIGlzIG5vdCBwcm92aWRlZFxyXG4gICAgY29uc3QgY29udGVudFR5cGUgPSB0eXBlIHx8IGZpbGVUeXBlO1xyXG4gICAgXHJcbiAgICBpZiAoIW91dHB1dERpcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBvdXRwdXQgZGlyZWN0b3J5IHByb3ZpZGVkIScpO1xyXG4gICAgICBjb25zb2xlLmxvZygn4pqg77iPIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gVXNpbmcgZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBwcm92aWRlZCBvdXRwdXQgZGlyZWN0b3J5IG9yIGZhbGwgYmFjayB0byBkZWZhdWx0XHJcbiAgICBjb25zdCBiYXNlT3V0cHV0RGlyID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgIFxyXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHdlIHNob3VsZCBjcmVhdGUgYSBzdWJkaXJlY3RvcnlcclxuICAgIGNvbnN0IHVzZXJQcm92aWRlZE91dHB1dERpciA9ICEhb3V0cHV0RGlyO1xyXG4gICAgY29uc3QgY3JlYXRlU3ViZGlyZWN0b3J5ID0gdXNlclByb3ZpZGVkT3V0cHV0RGlyID8gZmFsc2UgOiBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAob3B0aW9ucy5jcmVhdGVTdWJkaXJlY3RvcnkgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuY3JlYXRlU3ViZGlyZWN0b3J5IDogdHJ1ZSk7XHJcbiAgIFxyXG4gICAvLyBHZW5lcmF0ZSBhcHByb3ByaWF0ZSBmaWxlbmFtZSBiYXNlZCBvbiB0eXBlIGFuZCBtZXRhZGF0YVxyXG4gICBjb25zdCBmaWxlbmFtZSA9IGdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZShuYW1lLCBjb250ZW50VHlwZSwgbWV0YWRhdGEpO1xyXG4gICBcclxuICAgLy8gRGV0ZXJtaW5lIFVSTCBzdGF0dXMgZm9yIHBhdGggdmFsaWRhdGlvblxyXG4gICBjb25zdCBpc1VybCA9IGNvbnRlbnRUeXBlID09PSAndXJsJyB8fCBjb250ZW50VHlwZSA9PT0gJ3BhcmVudHVybCc7XHJcblxyXG4gICAgLy8gR2V0IHRoZSBiYXNlIG5hbWUgd2l0aG91dCBleHRlbnNpb24gYW5kIGVuc3VyZSBpdCdzIHZhbGlkIGZvciB0aGUgZmlsZSBzeXN0ZW1cclxuICAgIC8vIE5vIG5lZWQgdG8gcmVwbGFjZSBzcGFjZXMgd2l0aCB1bmRlcnNjb3JlcyBvciBtYWtlIG90aGVyIGNoYW5nZXMgc2luY2UgY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSBhbHJlYWR5IGRpZCB0aGF0XHJcbiAgICBjb25zdCBiYXNlTmFtZSA9IGdldEJhc2VuYW1lKGZpbGVuYW1lKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OdIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gVXNpbmcgYmFzZSBuYW1lOiAke2Jhc2VOYW1lfWApO1xyXG5cclxuICAgIC8vIEZvciBvdXRwdXQgZGlyZWN0b3J5IHBhdGgsIHVzZSB0aGUgYmFzZSBuYW1lIGJ1dCB3aXRob3V0IHRpbWVzdGFtcCBzdWZmaXggaW4gdGhlIGRpcmVjdG9yeSBuYW1lXHJcbiAgICAvLyBUaGUgdGltZXN0YW1wIGlzIG9ubHkgYWRkZWQgdG8gcHJldmVudCBjb2xsaXNpb25zXHJcbiAgICBjb25zdCBvdXRwdXRCYXNlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/XHJcbiAgICAgIHBhdGguam9pbihiYXNlT3V0cHV0RGlyLCBgJHtiYXNlTmFtZX1fJHtEYXRlLm5vdygpfWApIDpcclxuICAgICAgYmFzZU91dHB1dERpcjtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhg8J+TgSBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIEdlbmVyYXRlZCBvdXRwdXQgcGF0aDogJHtvdXRwdXRCYXNlUGF0aH1gKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgb3V0cHV0IGRpcmVjdG9yeSB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS5jcmVhdGVEaXJlY3Rvcnkob3V0cHV0QmFzZVBhdGgsIHsgaXNVcmwgfSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBDcmVhdGVkIG91dHB1dCBkaXJlY3Rvcnk6ICR7b3V0cHV0QmFzZVBhdGh9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBGYWlsZWQgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgaW1hZ2VzIGRpcmVjdG9yeSBpZiB3ZSBoYXZlIGltYWdlc1xyXG4gICAgaWYgKGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAvLyBHcm91cCBpbWFnZXMgYnkgdGhlaXIgZGlyZWN0b3J5IHBhdGhzXHJcbiAgICAgIGNvbnN0IGltYWdlc0J5RGlyID0gbmV3IE1hcCgpO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICBpZiAoIWltYWdlIHx8ICFpbWFnZS5wYXRoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGltYWdlIG9iamVjdCBvciBtaXNzaW5nIHBhdGg6YCwgaW1hZ2UpO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIGRpcmVjdG9yeSBwYXJ0IGZyb20gdGhlIGltYWdlIHBhdGhcclxuICAgICAgICBjb25zdCBkaXJQYXRoID0gcGF0aC5kaXJuYW1lKGltYWdlLnBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghaW1hZ2VzQnlEaXIuaGFzKGRpclBhdGgpKSB7XHJcbiAgICAgICAgICBpbWFnZXNCeURpci5zZXQoZGlyUGF0aCwgW10pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpbWFnZXNCeURpci5nZXQoZGlyUGF0aCkucHVzaChpbWFnZSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBlYWNoIHVuaXF1ZSBkaXJlY3RvcnkgYW5kIHNhdmUgaXRzIGltYWdlc1xyXG4gICAgICBmb3IgKGNvbnN0IFtkaXJQYXRoLCBkaXJJbWFnZXNdIG9mIGltYWdlc0J5RGlyLmVudHJpZXMoKSkge1xyXG4gICAgICAgIGNvbnN0IGZ1bGxEaXJQYXRoID0gcGF0aC5qb2luKG91dHB1dEJhc2VQYXRoLCBkaXJQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TgSBDcmVhdGluZyBpbWFnZXMgZGlyZWN0b3J5OiAke2Z1bGxEaXJQYXRofWApO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS5jcmVhdGVEaXJlY3RvcnkoZnVsbERpclBhdGgsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gU2F2ZSBpbWFnZXMgdG8gdGhlaXIgcmVzcGVjdGl2ZSBkaXJlY3Rvcmllc1xyXG4gICAgICAgIGZvciAoY29uc3QgaW1hZ2Ugb2YgZGlySW1hZ2VzKSB7XHJcbiAgICAgICAgICBpZiAoaW1hZ2UgJiYgaW1hZ2UuZGF0YSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgaW1hZ2UucGF0aCk7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coYPCfkr4gU2F2aW5nIGltYWdlOiAke2ltYWdlUGF0aH1gKTtcclxuICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhlIGltYWdlIGRhdGEgaXMgaW4gdGhlIHJpZ2h0IGZvcm1hdFxyXG4gICAgICAgICAgICAgIGNvbnN0IGltYWdlRGF0YSA9IEJ1ZmZlci5pc0J1ZmZlcihpbWFnZS5kYXRhKSBcclxuICAgICAgICAgICAgICAgID8gaW1hZ2UuZGF0YSBcclxuICAgICAgICAgICAgICAgIDogKHR5cGVvZiBpbWFnZS5kYXRhID09PSAnc3RyaW5nJyAmJiBpbWFnZS5kYXRhLnN0YXJ0c1dpdGgoJ2RhdGE6JykpXHJcbiAgICAgICAgICAgICAgICAgID8gQnVmZmVyLmZyb20oaW1hZ2UuZGF0YS5zcGxpdCgnLCcpWzFdLCAnYmFzZTY0JylcclxuICAgICAgICAgICAgICAgICAgOiBCdWZmZXIuZnJvbShpbWFnZS5kYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoaW1hZ2VQYXRoLCBpbWFnZURhdGEsIG51bGwsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGltYWdlRXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgaW1hZ2U6ICR7aW1hZ2UucGF0aH1gLCBpbWFnZUVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3Q6YCwgaW1hZ2UpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIERldGVybWluZSBtYWluIGZpbGUgcGF0aCAtIHVzZSBiYXNlTmFtZSBpbnN0ZWFkIG9mIGhhcmRjb2RlZCAnZG9jdW1lbnQubWQnXHJcbiAgICAvLyBUaGlzIGVuc3VyZXMgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGlzIHByZXNlcnZlZCBldmVuIHdoZW4gY3JlYXRpbmcgYSBzdWJkaXJlY3RvcnlcclxuICAgIGNvbnN0IG1haW5GaWxlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/XHJcbiAgICAgIHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgYCR7YmFzZU5hbWV9Lm1kYCkgOlxyXG4gICAgICBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGAke2Jhc2VOYW1lfS5tZGApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBpbWFnZSByZWZlcmVuY2VzIHRvIHVzZSBPYnNpZGlhbiBmb3JtYXRcclxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVJbWFnZVJlZmVyZW5jZXMoY29udGVudCwgaW1hZ2VzKTtcclxuXHJcbiAgICAvLyBDbGVhbiBtZXRhZGF0YSBmaWVsZHMgYW5kIGNyZWF0ZSBtZXRhZGF0YSBvYmplY3RcclxuICAgIGNvbnN0IGZ1bGxNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsIC8vIEVuc3VyZSBmaWxlVHlwZSBpcyBpbmNsdWRlZCBpbiBtZXRhZGF0YVxyXG4gICAgICBjb252ZXJ0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgLi4ubWV0YWRhdGFcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgYW5kIG1lcmdlIGZyb250bWF0dGVyIGlmIGl0IGV4aXN0c1xyXG4gICAgY29uc3QgeyBtZXRhZGF0YTogZXhpc3RpbmdNZXRhZGF0YSwgY29udGVudDogY29udGVudFdpdGhvdXRGcm9udG1hdHRlciB9ID0gZXh0cmFjdEZyb250bWF0dGVyKHVwZGF0ZWRDb250ZW50KTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5OdIEV4dHJhY3RlZCBleGlzdGluZyBmcm9udG1hdHRlcjonLCBleGlzdGluZ01ldGFkYXRhKTtcclxuICAgIFxyXG4gICAgLy8gTWVyZ2UgbWV0YWRhdGEgdXNpbmcgc2hhcmVkIHV0aWxpdHlcclxuICAgIGNvbnN0IG1lcmdlZE1ldGFkYXRhID0gbWVyZ2VNZXRhZGF0YShleGlzdGluZ01ldGFkYXRhLCBmdWxsTWV0YWRhdGEsIHtcclxuICAgICAgdHlwZTogZnVsbE1ldGFkYXRhLnR5cGUsIC8vIEVuc3VyZSB0eXBlIGZyb20gZnVsbE1ldGFkYXRhIHRha2VzIHByZWNlZGVuY2VcclxuICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgLy8gQWx3YXlzIHVzZSBjdXJyZW50IHRpbWVzdGFtcFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEZvcm1hdCBhbmQgY29tYmluZSB3aXRoIGNvbnRlbnRcclxuICAgIGNvbnN0IGZyb250bWF0dGVyID0gZm9ybWF0TWV0YWRhdGEobWVyZ2VkTWV0YWRhdGEpO1xyXG4gICAgY29uc3QgZnVsbENvbnRlbnQgPSBmcm9udG1hdHRlciArIGNvbnRlbnRXaXRob3V0RnJvbnRtYXR0ZXI7XHJcblxyXG4gICAgLy8gU2F2ZSB0aGUgbWFya2Rvd24gY29udGVudCB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUobWFpbkZpbGVQYXRoLCBmdWxsQ29udGVudCwgJ3V0ZjgnLCB7IGlzVXJsIH0pO1xyXG5cclxuICAgIC8vIEhhbmRsZSBhZGRpdGlvbmFsIGZpbGVzIGlmIHByb3ZpZGVkIChmb3IgbXVsdGktZmlsZSBjb252ZXJzaW9ucyBsaWtlIHBhcmVudHVybClcclxuICAgIGlmIChmaWxlcyAmJiBBcnJheS5pc0FycmF5KGZpbGVzKSAmJiBmaWxlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gUHJvY2Vzc2luZyAke2ZpbGVzLmxlbmd0aH0gYWRkaXRpb25hbCBmaWxlc2ApO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgaWYgKCFmaWxlIHx8ICFmaWxlLm5hbWUgfHwgIWZpbGUuY29udGVudCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBmaWxlIG9iamVjdDpgLCBmaWxlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRW5zdXJlIHRoZSBkaXJlY3RvcnkgZXhpc3RzXHJcbiAgICAgICAgICBjb25zdCBmaWxlRGlyUGF0aCA9IHBhdGguZGlybmFtZShwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSkpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShmaWxlRGlyUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gU2F2ZSB0aGUgZmlsZVxyXG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBTYXZpbmcgYWRkaXRpb25hbCBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgd2UgbmVlZCB0byBhZGQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgIGxldCBmaWxlQ29udGVudCA9IGZpbGUuY29udGVudDtcclxuICAgICAgICAgIGlmIChmaWxlLnR5cGUgPT09ICd0ZXh0JyAmJiAhZmlsZUNvbnRlbnQudHJpbSgpLnN0YXJ0c1dpdGgoJy0tLScpKSB7XHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBtZXRhZGF0YSBmb3IgdGhpcyBmaWxlXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICAgICAgICAgIHR5cGU6IGZpbGUudHlwZSB8fCAndGV4dCcsXHJcbiAgICAgICAgICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICAgICAgLi4uKGZpbGUubWV0YWRhdGEgfHwge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGZyb250bWF0dGVyXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVGcm9udG1hdHRlciA9IGZvcm1hdE1ldGFkYXRhKGZpbGVNZXRhZGF0YSk7XHJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ID0gZmlsZUZyb250bWF0dGVyICsgZmlsZUNvbnRlbnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50LCAndXRmOCcsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZmlsZUVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgZmlsZTogJHtmaWxlLm5hbWV9YCwgZmlsZUVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgdGhlIHJlc3VsdCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+SviBDb252ZXJzaW9uIHJlc3VsdCBzYXZlZDonLCB7XHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoLFxyXG4gICAgICBoYXNJbWFnZXM6IGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCxcclxuICAgICAgaW1hZ2VDb3VudDogaW1hZ2VzID8gaW1hZ2VzLmxlbmd0aCA6IDAsXHJcbiAgICAgIGFkZGl0aW9uYWxGaWxlczogZmlsZXMgPyBmaWxlcy5sZW5ndGggOiAwLFxyXG4gICAgICBjb250ZW50TGVuZ3RoOiBmdWxsQ29udGVudC5sZW5ndGhcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpXHJcbiAgICBjb25zdCBpc0RhdGFGaWxlID0gY29udGVudFR5cGUgPT09ICdjc3YnIHx8IGNvbnRlbnRUeXBlID09PSAneGxzeCcgfHxcclxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVUeXBlID09PSAnY3N2JyB8fCBmaWxlVHlwZSA9PT0gJ3hsc3gnO1xyXG4gICAgaWYgKGlzRGF0YUZpbGUpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGU6ICR7dHlwZX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGFsbCByZXF1aXJlZCBwcm9wZXJ0aWVzIGZvciBkYXRhIGZpbGVzXHJcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7XHJcbiAgICAgICAgbWV0YWRhdGEuZm9ybWF0ID0gdHlwZTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKCFtZXRhZGF0YS50eXBlKSB7XHJcbiAgICAgICAgbWV0YWRhdGEudHlwZSA9ICdzcHJlYWRzaGVldCc7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBhZGRpdGlvbmFsIGxvZ2dpbmcgZm9yIGRhdGEgZmlsZXNcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBEYXRhIGZpbGUgbWV0YWRhdGE6YCwgbWV0YWRhdGEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgd2UgaGF2ZSBhIHZhbGlkIG91dHB1dCBwYXRoXHJcbiAgICBpZiAoIW91dHB1dEJhc2VQYXRoKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG91dHB1dCBwYXRoIGdlbmVyYXRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgb3V0cHV0IHBhdGgnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gUmV0dXJuIHN0YW5kYXJkaXplZCByZXN1bHQgd2l0aCBndWFyYW50ZWVkIG91dHB1dFBhdGhcclxuICAgIGNvbnN0IHJlc3VsdCA9IHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGgsXHJcbiAgICAgIG1ldGFkYXRhOiBmdWxsTWV0YWRhdGFcclxuICAgIH07XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTdWNjZXNzZnVsbHkgc2F2ZWQgY29udmVyc2lvbiByZXN1bHQ6YCwge1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsXHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUUsUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdILE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDeEUsTUFBTTtFQUFFSSxjQUFjO0VBQUVDLGFBQWE7RUFBRUMsa0JBQWtCO0VBQUVDO0FBQWMsQ0FBQyxHQUFHUCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDekcsTUFBTTtFQUFFUSxzQkFBc0I7RUFBRUMsV0FBVztFQUFFQztBQUFvQixDQUFDLEdBQUdWLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQzs7QUFFOUY7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNXLDJCQUEyQkEsQ0FBQ0MsWUFBWSxFQUFFQyxJQUFJLEVBQUVDLFFBQVEsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUN0RUMsT0FBTyxDQUFDQyxHQUFHLENBQUMseURBQXlESixZQUFZLEtBQUtDLElBQUksR0FBRyxDQUFDOztFQUU5RjtFQUNBLElBQUlBLElBQUksS0FBSyxLQUFLLElBQUlDLFFBQVEsQ0FBQ0csVUFBVSxFQUFFO0lBQ3pDLE9BQU9QLG1CQUFtQixDQUFDSSxRQUFRLENBQUNHLFVBQVUsQ0FBQztFQUNqRDs7RUFFQTtFQUNBLElBQUlKLElBQUksS0FBSyxNQUFNLElBQUlBLElBQUksS0FB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