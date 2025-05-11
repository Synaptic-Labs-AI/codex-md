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

      // Preserve the complete original filename (including numbers and special characters)
      // Only replace characters that are invalid for the filesystem
      const safeFilename = cleanTemporaryFilename(metadata.originalFileName);
      console.log(`📊 [ConversionResultManager] Preserving full original filename: ${metadata.originalFileName} -> ${safeFilename}`);
      return safeFilename;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsImluc3RhbmNlIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJleHRyYWN0RnJvbnRtYXR0ZXIiLCJtZXJnZU1ldGFkYXRhIiwiY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSIsImdldEJhc2VuYW1lIiwiZ2VuZXJhdGVVcmxGaWxlbmFtZSIsImdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZSIsIm9yaWdpbmFsTmFtZSIsInR5cGUiLCJtZXRhZGF0YSIsImNvbnNvbGUiLCJsb2ciLCJzb3VyY2VfdXJsIiwib3JpZ2luYWxGaWxlTmFtZSIsIk9iamVjdCIsImtleXMiLCJqb2luIiwic2FmZUZpbGVuYW1lIiwid2FybiIsImNsZWFuZWROYW1lIiwiZXNjYXBlUmVnRXhwIiwic3RyaW5nIiwidW5kZWZpbmVkIiwicmVwbGFjZSIsImVycm9yIiwiaXNVcmwiLCJzdGFydHNXaXRoIiwiQ29udmVyc2lvblJlc3VsdE1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVTeXN0ZW0iLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsInVwZGF0ZUltYWdlUmVmZXJlbmNlcyIsImNvbnRlbnQiLCJpbWFnZXMiLCJBcnJheSIsImlzQXJyYXkiLCJsZW5ndGgiLCJ1cGRhdGVkQ29udGVudCIsImdlbmVyaWNNYXJrZG93blBhdHRlcm4iLCJwcm9jZXNzZWRJbWFnZUlkcyIsIlNldCIsImltYWdlUGF0aHMiLCJNYXAiLCJmb3JFYWNoIiwiaW1hZ2UiLCJpbWFnZVBhdGgiLCJuYW1lIiwic3JjIiwic2V0IiwiYmFzZW5hbWUiLCJtYXRjaCIsImFsdCIsImltYWdlSWQiLCJoYXMiLCJnZXQiLCJhZGQiLCJtYXJrZG93blBhdHRlcm4iLCJSZWdFeHAiLCJtYXJrZG93bkFueVBhdHRlcm4iLCJvYnNpZGlhblBhdHRlcm4iLCJjb3JyZWN0T2JzaWRpYW5Gb3JtYXQiLCJpbmNsdWRlcyIsIm1hdGNoZXMiLCJtYXRjaFBhdGgiLCJzdWJzdHJpbmciLCJleHRuYW1lIiwiaW1hZ2VFcnJvciIsImV4dHJhY3RlZEltYWdlc1BhdHRlcm4iLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImZpbGVzIiwiZmlsZVR5cGUiLCJvdXRwdXREaXIiLCJvcHRpb25zIiwiRXJyb3IiLCJjb250ZW50VHlwZSIsImJhc2VPdXRwdXREaXIiLCJ1c2VyUHJvdmlkZWRPdXRwdXREaXIiLCJjcmVhdGVTdWJkaXJlY3RvcnkiLCJmaWxlbmFtZSIsImJhc2VOYW1lIiwib3V0cHV0QmFzZVBhdGgiLCJEYXRlIiwibm93IiwiY3JlYXRlRGlyZWN0b3J5IiwibWVzc2FnZSIsImltYWdlc0J5RGlyIiwiZGlyUGF0aCIsImRpcm5hbWUiLCJwdXNoIiwiZGlySW1hZ2VzIiwiZW50cmllcyIsImZ1bGxEaXJQYXRoIiwiZGF0YSIsImltYWdlRGF0YSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZnJvbSIsInNwbGl0Iiwid3JpdGVGaWxlIiwibWFpbkZpbGVQYXRoIiwiZnVsbE1ldGFkYXRhIiwiY29udmVydGVkIiwidG9JU09TdHJpbmciLCJleGlzdGluZ01ldGFkYXRhIiwiY29udGVudFdpdGhvdXRGcm9udG1hdHRlciIsIm1lcmdlZE1ldGFkYXRhIiwiZnJvbnRtYXR0ZXIiLCJmdWxsQ29udGVudCIsImZpbGUiLCJmaWxlRGlyUGF0aCIsImZpbGVQYXRoIiwiZmlsZUNvbnRlbnQiLCJ0cmltIiwiZmlsZU1ldGFkYXRhIiwiZmlsZUZyb250bWF0dGVyIiwiZmlsZUVycm9yIiwib3V0cHV0UGF0aCIsIm1haW5GaWxlIiwiaGFzSW1hZ2VzIiwiaW1hZ2VDb3VudCIsImFkZGl0aW9uYWxGaWxlcyIsImNvbnRlbnRMZW5ndGgiLCJpc0RhdGFGaWxlIiwiZm9ybWF0IiwicmVzdWx0Iiwic3VjY2VzcyIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvQ29udmVyc2lvblJlc3VsdE1hbmFnZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyLmpzXHJcbiAqIFxyXG4gKiBIYW5kbGVzIHNhdmluZyBjb252ZXJzaW9uIHJlc3VsdHMgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZy5cclxuICogTWFuYWdlcyBvdXRwdXQgZGlyZWN0b3J5IHN0cnVjdHVyZSwgaW1hZ2Ugc2F2aW5nLCBhbmQgbWV0YWRhdGEgZm9ybWF0dGluZy5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0VsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IFVzZXMgdGhpcyBzZXJ2aWNlIGZvciBzYXZpbmcgY29udmVyc2lvbiByZXN1bHRzXHJcbiAqIC0gc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0ZpbGVTeXN0ZW1TZXJ2aWNlLmpzOiBVc2VkIGZvciBmaWxlIHN5c3RlbSBvcGVyYXRpb25zXHJcbiAqIC0gc3JjL2VsZWN0cm9uL2FkYXB0ZXJzL21ldGFkYXRhRXh0cmFjdG9yQWRhcHRlci5qczogVXNlZCBmb3IgbWV0YWRhdGEgZm9ybWF0dGluZ1xyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IGluc3RhbmNlOiBGaWxlU3lzdGVtU2VydmljZSB9ID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpOyAvLyBJbXBvcnQgaW5zdGFuY2VcclxuY29uc3QgeyBmb3JtYXRNZXRhZGF0YSwgY2xlYW5NZXRhZGF0YSwgZXh0cmFjdEZyb250bWF0dGVyLCBtZXJnZU1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi91dGlscy9tYXJrZG93bicpO1xyXG5jb25zdCB7IGNsZWFuVGVtcG9yYXJ5RmlsZW5hbWUsIGdldEJhc2VuYW1lLCBnZW5lcmF0ZVVybEZpbGVuYW1lIH0gPSByZXF1aXJlKCcuLi91dGlscy9maWxlcycpO1xyXG5cclxuLyoqXHJcbiAqIEdlbmVyYXRlIGFwcHJvcHJpYXRlIGZpbGVuYW1lIGJhc2VkIG9uIGNvbnZlcnNpb24gdHlwZSBhbmQgbWV0YWRhdGFcclxuICogQHByaXZhdGVcclxuICogQHBhcmFtIHtzdHJpbmd9IG9yaWdpbmFsTmFtZSAtIE9yaWdpbmFsIGZpbGVuYW1lIG9yIFVSTFxyXG4gKiBAcGFyYW0ge3N0cmluZ30gdHlwZSAtIFR5cGUgb2YgY29udmVyc2lvbiAoZS5nLiwgJ3VybCcsICdwZGYnKVxyXG4gKiBAcGFyYW0ge09iamVjdH0gbWV0YWRhdGEgLSBNZXRhZGF0YSBmcm9tIGNvbnZlcnNpb25cclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGFwcHJvcHJpYXRlIGZpbGVuYW1lXHJcbiAqL1xyXG5mdW5jdGlvbiBnZW5lcmF0ZUFwcHJvcHJpYXRlRmlsZW5hbWUob3JpZ2luYWxOYW1lLCB0eXBlLCBtZXRhZGF0YSA9IHt9KSB7XHJcbiAgY29uc29sZS5sb2coYPCflIQgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0aW5nIGZpbGVuYW1lIGZvcjogJHtvcmlnaW5hbE5hbWV9ICgke3R5cGV9KWApO1xyXG5cclxuICAvLyBGb3IgVVJMIGNvbnZlcnNpb25zLCBnZW5lcmF0ZSBmcm9tIHRoZSBzb3VyY2UgVVJMIGlmIGF2YWlsYWJsZVxyXG4gIGlmICh0eXBlID09PSAndXJsJyAmJiBtZXRhZGF0YS5zb3VyY2VfdXJsKSB7XHJcbiAgICByZXR1cm4gZ2VuZXJhdGVVcmxGaWxlbmFtZShtZXRhZGF0YS5zb3VyY2VfdXJsKTtcclxuICB9XHJcblxyXG4gIC8vIEZvciBFeGNlbCBhbmQgZGF0YSBmaWxlcywgcHJpb3JpdGl6ZSBvcmlnaW5hbEZpbGVOYW1lIGZyb20gbWV0YWRhdGFcclxuICBpZiAodHlwZSA9PT0gJ3hsc3gnIHx8IHR5cGUgPT09ICdjc3YnKSB7XHJcbiAgICAvLyBVc2UgdGhlIG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUgaWYgYXZhaWxhYmxlIChhZGRlZCBpbiBvdXIgZml4IHRvIGNvbnZlcnRlcnMpXHJcbiAgICBpZiAobWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZSkge1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIG9yaWdpbmFsRmlsZU5hbWUgZnJvbSBtZXRhZGF0YTogJHttZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lfWApO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIEF2YWlsYWJsZSBtZXRhZGF0YSBrZXlzOiAke09iamVjdC5rZXlzKG1ldGFkYXRhKS5qb2luKCcsICcpfWApO1xyXG5cclxuICAgICAgLy8gUHJlc2VydmUgdGhlIGNvbXBsZXRlIG9yaWdpbmFsIGZpbGVuYW1lIChpbmNsdWRpbmcgbnVtYmVycyBhbmQgc3BlY2lhbCBjaGFyYWN0ZXJzKVxyXG4gICAgICAvLyBPbmx5IHJlcGxhY2UgY2hhcmFjdGVycyB0aGF0IGFyZSBpbnZhbGlkIGZvciB0aGUgZmlsZXN5c3RlbVxyXG4gICAgICBjb25zdCBzYWZlRmlsZW5hbWUgPSBjbGVhblRlbXBvcmFyeUZpbGVuYW1lKG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiiBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFByZXNlcnZpbmcgZnVsbCBvcmlnaW5hbCBmaWxlbmFtZTogJHttZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lfSAtPiAke3NhZmVGaWxlbmFtZX1gKTtcclxuICAgICAgcmV0dXJuIHNhZmVGaWxlbmFtZTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgaWYgb3JpZ2luYWxGaWxlTmFtZSBpcyBtaXNzaW5nIGZvciBzcHJlYWRzaGVldCBmaWxlc1xyXG4gICAgY29uc29sZS53YXJuKGDimqDvuI8gW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBvcmlnaW5hbEZpbGVOYW1lIGZvdW5kIGluIG1ldGFkYXRhIGZvciAke3R5cGV9IGZpbGUuIE1ldGFkYXRhIGtleXM6ICR7T2JqZWN0LmtleXMobWV0YWRhdGEpLmpvaW4oJywgJyl9YCk7XHJcbiAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIGZhbGxiYWNrOiAke29yaWdpbmFsTmFtZX1gKTtcclxuICB9XHJcblxyXG4gIC8vIEZvciBhbGwgb3RoZXIgZmlsZXMsIGNsZWFuIHRoZSBvcmlnaW5hbCBuYW1lXHJcbiAgY29uc3QgY2xlYW5lZE5hbWUgPSBjbGVhblRlbXBvcmFyeUZpbGVuYW1lKG9yaWdpbmFsTmFtZSk7XHJcbiAgY29uc29sZS5sb2coYPCfk4QgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0ZWQgZmlsZW5hbWU6ICR7Y2xlYW5lZE5hbWV9YCk7XHJcbiAgcmV0dXJuIGNsZWFuZWROYW1lO1xyXG59XHJcblxyXG4vKipcclxuICogSGVscGVyIGZ1bmN0aW9uIHRvIGVzY2FwZSBzcGVjaWFsIGNoYXJhY3RlcnMgaW4gcmVndWxhciBleHByZXNzaW9uc1xyXG4gKiBAcGFyYW0ge3N0cmluZ30gc3RyaW5nIC0gVGhlIHN0cmluZyB0byBlc2NhcGVcclxuICogQHJldHVybnMge3N0cmluZ30gVGhlIGVzY2FwZWQgc3RyaW5nXHJcbiAqL1xyXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAoc3RyaW5nKSB7XHJcbiAgLy8gSGFuZGxlIG51bGwsIHVuZGVmaW5lZCwgb3Igbm9uLXN0cmluZyBpbnB1dHNcclxuICBpZiAoc3RyaW5nID09PSBudWxsIHx8IHN0cmluZyA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSB7XHJcbiAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGlucHV0IHRvIGVzY2FwZVJlZ0V4cDogJHtzdHJpbmd9YCk7XHJcbiAgICByZXR1cm4gJyc7XHJcbiAgfVxyXG4gIFxyXG4gIHRyeSB7XHJcbiAgICByZXR1cm4gc3RyaW5nLnJlcGxhY2UoL1suKis/XiR7fSgpfFtcXF1cXFxcXS9nLCAnXFxcXCQmJyk7XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBFcnJvciBpbiBlc2NhcGVSZWdFeHA6YCwgZXJyb3IpO1xyXG4gICAgcmV0dXJuICcnO1xyXG4gIH1cclxufVxyXG5cclxuLyoqXHJcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBjaGVjayBpZiBhIHBhdGggaXMgYSBVUkxcclxuICogQHBhcmFtIHtzdHJpbmd9IHBhdGggLSBUaGUgcGF0aCB0byBjaGVja1xyXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgcGF0aCBpcyBhIFVSTFxyXG4gKi9cclxuZnVuY3Rpb24gaXNVcmwocGF0aCkge1xyXG4gIHJldHVybiB0eXBlb2YgcGF0aCA9PT0gJ3N0cmluZycgJiYgKHBhdGguc3RhcnRzV2l0aCgnaHR0cDovLycpIHx8IHBhdGguc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSk7XHJcbn1cclxuXHJcbmNsYXNzIENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZmlsZVN5c3RlbSA9IEZpbGVTeXN0ZW1TZXJ2aWNlO1xyXG4gICAgdGhpcy5kZWZhdWx0T3V0cHV0RGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY29udmVyc2lvbnMnKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyIGluaXRpYWxpemVkIHdpdGggZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGRhdGUgaW1hZ2UgcmVmZXJlbmNlcyB0byB1c2UgT2JzaWRpYW4gZm9ybWF0XHJcbiAgICogQHByaXZhdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gY29udGVudCAtIFRoZSBjb250ZW50IHRvIHVwZGF0ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IGltYWdlcyAtIEFycmF5IG9mIGltYWdlIG9iamVjdHNcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVcGRhdGVkIGNvbnRlbnQgd2l0aCBPYnNpZGlhbiBpbWFnZSByZWZlcmVuY2VzXHJcbiAgICovXHJcbiAgdXBkYXRlSW1hZ2VSZWZlcmVuY2VzKGNvbnRlbnQsIGltYWdlcykge1xyXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRzXHJcbiAgICBpZiAoIWNvbnRlbnQgfHwgdHlwZW9mIGNvbnRlbnQgIT09ICdzdHJpbmcnKSB7XHJcbiAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEludmFsaWQgY29udGVudCBwcm92aWRlZCB0byB1cGRhdGVJbWFnZVJlZmVyZW5jZXMnKTtcclxuICAgICAgcmV0dXJuIGNvbnRlbnQgfHwgJyc7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghaW1hZ2VzIHx8ICFBcnJheS5pc0FycmF5KGltYWdlcykgfHwgaW1hZ2VzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4gY29udGVudDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgbGV0IHVwZGF0ZWRDb250ZW50ID0gY29udGVudDtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gRmlyc3QsIGhhbmRsZSBhbnkgZ2VuZXJpYyBzdGFuZGFyZCBNYXJrZG93biBpbWFnZSBsaW5rcyB0aGF0IG1pZ2h0IG5vdCBiZSBhc3NvY2lhdGVkIHdpdGggb3VyIGltYWdlc1xyXG4gICAgICAvLyBUaGlzIGlzIGVzcGVjaWFsbHkgaW1wb3J0YW50IGZvciBNaXN0cmFsIE9DUiByZXN1bHRzXHJcbiAgICAgIGNvbnN0IGdlbmVyaWNNYXJrZG93blBhdHRlcm4gPSAvIVxcWyguKj8pXFxdXFwoKC4qPylcXCkvZztcclxuICAgICAgY29uc3QgcHJvY2Vzc2VkSW1hZ2VJZHMgPSBuZXcgU2V0KCk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgYSBtYXAgb2YgaW1hZ2UgcGF0aHMgZm9yIHF1aWNrIGxvb2t1cFxyXG4gICAgICBjb25zdCBpbWFnZVBhdGhzID0gbmV3IE1hcCgpO1xyXG4gICAgICBpbWFnZXMuZm9yRWFjaChpbWFnZSA9PiB7XHJcbiAgICAgICAgaWYgKGltYWdlICYmIHR5cGVvZiBpbWFnZSA9PT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBpZiAoaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIC8vIFN0b3JlIGJvdGggdGhlIGZ1bGwgcGF0aCBhbmQgdGhlIGJhc2VuYW1lIGZvciBtYXRjaGluZ1xyXG4gICAgICAgICAgICBpbWFnZVBhdGhzLnNldChpbWFnZVBhdGgsIGltYWdlUGF0aCk7XHJcbiAgICAgICAgICAgIGltYWdlUGF0aHMuc2V0KHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKSwgaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gUmVwbGFjZSBnZW5lcmljIE1hcmtkb3duIGltYWdlIGxpbmtzIHdpdGggT2JzaWRpYW4gZm9ybWF0IGlmIHdlIGhhdmUgYSBtYXRjaGluZyBpbWFnZVxyXG4gICAgICAvLyBCdXQgcHJlc2VydmUgVVJMIGltYWdlcyBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGdlbmVyaWNNYXJrZG93blBhdHRlcm4sIChtYXRjaCwgYWx0LCBzcmMpID0+IHtcclxuICAgICAgICAvLyBJZiBpdCdzIGEgVVJMLCBrZWVwIGl0IGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICAgIGlmIChpc1VybChzcmMpKSB7XHJcbiAgICAgICAgICByZXR1cm4gbWF0Y2g7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIGltYWdlIElEIGZyb20gdGhlIHNyY1xyXG4gICAgICAgIGNvbnN0IGltYWdlSWQgPSBwYXRoLmJhc2VuYW1lKHNyYyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gSWYgd2UgaGF2ZSBhIG1hdGNoaW5nIGltYWdlLCB1c2UgdGhlIE9ic2lkaWFuIGZvcm1hdFxyXG4gICAgICAgIGlmIChpbWFnZVBhdGhzLmhhcyhpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmhhcyhzcmMpKSB7XHJcbiAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBpbWFnZVBhdGhzLmdldChpbWFnZUlkKSB8fCBpbWFnZVBhdGhzLmdldChzcmMpO1xyXG4gICAgICAgICAgcHJvY2Vzc2VkSW1hZ2VJZHMuYWRkKGltYWdlSWQpO1xyXG4gICAgICAgICAgcmV0dXJuIGAhW1ske2ltYWdlUGF0aH1dXWA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE90aGVyd2lzZSwga2VlcCB0aGUgb3JpZ2luYWwgcmVmZXJlbmNlXHJcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIE5vdyBwcm9jZXNzIGVhY2ggaW1hZ2Ugc3BlY2lmaWNhbGx5XHJcbiAgICAgIGltYWdlcy5mb3JFYWNoKGltYWdlID0+IHtcclxuICAgICAgICAvLyBTa2lwIGludmFsaWQgaW1hZ2Ugb2JqZWN0c1xyXG4gICAgICAgIGlmICghaW1hZ2UgfHwgdHlwZW9mIGltYWdlICE9PSAnb2JqZWN0Jykge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKCfimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3QgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGltYWdlKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIC8vIERldGVybWluZSB0aGUgaW1hZ2UgcGF0aCB0byB1c2VcclxuICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IGltYWdlLnBhdGggfHwgaW1hZ2UubmFtZSB8fCAoaW1hZ2Uuc3JjID8gaW1hZ2Uuc3JjIDogbnVsbCk7XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGlmICghaW1hZ2VQYXRoKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEltYWdlIG9iamVjdCBoYXMgbm8gcGF0aCwgbmFtZSwgb3Igc3JjOicsIGltYWdlKTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBTa2lwIGlmIHdlIGFscmVhZHkgcHJvY2Vzc2VkIHRoaXMgaW1hZ2UgaW4gdGhlIGdlbmVyaWMgcGFzc1xyXG4gICAgICAgICAgY29uc3QgaW1hZ2VJZCA9IHBhdGguYmFzZW5hbWUoaW1hZ2VQYXRoKTtcclxuICAgICAgICAgIGlmIChwcm9jZXNzZWRJbWFnZUlkcy5oYXMoaW1hZ2VJZCkpIHtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBGaXJzdCByZXBsYWNlIHN0YW5kYXJkIG1hcmtkb3duIGltYWdlIHN5bnRheFxyXG4gICAgICAgICAgaWYgKGltYWdlLnNyYykge1xyXG4gICAgICAgICAgICAvLyBTa2lwIFVSTCBpbWFnZXMgLSBrZWVwIHRoZW0gaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2Uuc3JjKSkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hcmtkb3duUGF0dGVybiA9IG5ldyBSZWdFeHAoYCFcXFxcW1teXFxcXF1dKlxcXFxdXFxcXCgke2VzY2FwZVJlZ0V4cChpbWFnZS5zcmMpfVteKV0qXFxcXClgLCAnZycpO1xyXG4gICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXJrZG93blBhdHRlcm4sIGAhW1ske2ltYWdlUGF0aH1dXWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2Ugc3RhbmRhcmQgbWFya2Rvd24gaW1hZ2Ugc3ludGF4IHdpdGggYW55IHBhdGhcclxuICAgICAgICAgIC8vIFNraXAgVVJMIGltYWdlcyAtIGtlZXAgdGhlbSBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgICAgIGlmICghaXNVcmwoaW1hZ2VQYXRoKSkge1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93bkFueVBhdHRlcm4gPSBuZXcgUmVnRXhwKGAhXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFwoJHtlc2NhcGVSZWdFeHAoaW1hZ2VQYXRoKX1bXildKlxcXFwpYCwgJ2cnKTtcclxuICAgICAgICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKG1hcmtkb3duQW55UGF0dGVybiwgYCFbWyR7aW1hZ2VQYXRofV1dYCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIC8vIFJlcGxhY2UgYW55IGV4aXN0aW5nIE9ic2lkaWFuIHN5bnRheCB0aGF0IGRvZXNuJ3QgbWF0Y2ggb3VyIGV4cGVjdGVkIGZvcm1hdFxyXG4gICAgICAgICAgY29uc3Qgb2JzaWRpYW5QYXR0ZXJuID0gbmV3IFJlZ0V4cChgIVxcXFxbXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFxdYCwgJ2cnKTtcclxuICAgICAgICAgIC8vIE9ubHkgcmVwbGFjZSBpZiBpdCdzIG5vdCBhbHJlYWR5IGluIHRoZSBjb3JyZWN0IGZvcm1hdCBhbmQgbm90IGEgVVJMXHJcbiAgICAgICAgICBpZiAoIWlzVXJsKGltYWdlUGF0aCkpIHtcclxuICAgICAgICAgICAgY29uc3QgY29ycmVjdE9ic2lkaWFuRm9ybWF0ID0gYCFbWyR7aW1hZ2VQYXRofV1dYDtcclxuICAgICAgICAgICAgaWYgKCF1cGRhdGVkQ29udGVudC5pbmNsdWRlcyhjb3JyZWN0T2JzaWRpYW5Gb3JtYXQpKSB7XHJcbiAgICAgICAgICAgICAgLy8gRmluZCBhbGwgT2JzaWRpYW4gaW1hZ2UgcmVmZXJlbmNlc1xyXG4gICAgICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSB1cGRhdGVkQ29udGVudC5tYXRjaChvYnNpZGlhblBhdHRlcm4pO1xyXG4gICAgICAgICAgICAgIGlmIChtYXRjaGVzKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBSZXBsYWNlIG9ubHkgdGhvc2UgdGhhdCBjb250YWluIHBhcnRzIG9mIG91ciBpbWFnZSBwYXRoXHJcbiAgICAgICAgICAgICAgICBtYXRjaGVzLmZvckVhY2gobWF0Y2ggPT4ge1xyXG4gICAgICAgICAgICAgICAgICAvLyBFeHRyYWN0IHRoZSBwYXRoIGZyb20gdGhlIG1hdGNoXHJcbiAgICAgICAgICAgICAgICAgIGNvbnN0IG1hdGNoUGF0aCA9IG1hdGNoLnN1YnN0cmluZygzLCBtYXRjaC5sZW5ndGggLSAyKTtcclxuICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgIC8vIENoZWNrIGlmIHRoaXMgbWF0Y2ggaXMgcmVsYXRlZCB0byBvdXIgaW1hZ2VcclxuICAgICAgICAgICAgICAgICAgaWYgKG1hdGNoUGF0aC5pbmNsdWRlcyhwYXRoLmJhc2VuYW1lKGltYWdlUGF0aCwgcGF0aC5leHRuYW1lKGltYWdlUGF0aCkpKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXRjaCwgY29ycmVjdE9ic2lkaWFuRm9ybWF0KTtcclxuICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoaW1hZ2VFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gRXJyb3IgcHJvY2Vzc2luZyBpbWFnZSByZWZlcmVuY2U6YCwgaW1hZ2VFcnJvcik7XHJcbiAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG5leHQgaW1hZ2VcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgLy8gRmluYWxseSwgcmVtb3ZlIGFueSBcIkV4dHJhY3RlZCBJbWFnZXNcIiBzZWN0aW9uIHRoYXQgbWlnaHQgaGF2ZSBiZWVuIGFkZGVkXHJcbiAgICAgIGNvbnN0IGV4dHJhY3RlZEltYWdlc1BhdHRlcm4gPSAvXFxuXFxuIyMgRXh0cmFjdGVkIEltYWdlc1xcblxcbig/OiFcXFtcXFtbXlxcXV0rXFxdXFxdXFxuXFxuKSovZztcclxuICAgICAgdXBkYXRlZENvbnRlbnQgPSB1cGRhdGVkQ29udGVudC5yZXBsYWNlKGV4dHJhY3RlZEltYWdlc1BhdHRlcm4sICcnKTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgaW4gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzOicsIGVycm9yKTtcclxuICAgICAgLy8gUmV0dXJuIG9yaWdpbmFsIGNvbnRlbnQgb24gZXJyb3JcclxuICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHVwZGF0ZWRDb250ZW50O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2F2ZXMgY29udmVyc2lvbiByZXN1bHQgdG8gZGlzayB3aXRoIGNvbnNpc3RlbnQgZmlsZSBoYW5kbGluZ1xyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gT3B0aW9ucyBmb3Igc2F2aW5nIHRoZSBjb252ZXJzaW9uIHJlc3VsdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLmNvbnRlbnQgLSBUaGUgY29udGVudCB0byBzYXZlXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm1ldGFkYXRhPXt9XSAtIE1ldGFkYXRhIHRvIGluY2x1ZGUgaW4gdGhlIGZyb250bWF0dGVyXHJcbiAgICogQHBhcmFtIHtBcnJheX0gW29wdGlvbnMuaW1hZ2VzPVtdXSAtIEFycmF5IG9mIGltYWdlIG9iamVjdHMgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IFtvcHRpb25zLmZpbGVzPVtdXSAtIEFycmF5IG9mIGFkZGl0aW9uYWwgZmlsZXMgdG8gc2F2ZSAoZm9yIG11bHRpLWZpbGUgY29udmVyc2lvbnMpXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IG9wdGlvbnMubmFtZSAtIEJhc2UgbmFtZSBmb3IgdGhlIG91dHB1dCBmaWxlL2RpcmVjdG9yeVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLnR5cGUgLSBUeXBlIG9mIGNvbnRlbnQgKGUuZy4sICdwZGYnLCAndXJsJywgZXRjLilcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gW29wdGlvbnMub3V0cHV0RGlyXSAtIEN1c3RvbSBvdXRwdXQgZGlyZWN0b3J5XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IFtvcHRpb25zLm9wdGlvbnM9e31dIC0gQWRkaXRpb25hbCBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gUmVzdWx0IG9mIHRoZSBzYXZlIG9wZXJhdGlvblxyXG4gICAqL1xyXG4gIGFzeW5jIHNhdmVDb252ZXJzaW9uUmVzdWx0KHsgY29udGVudCwgbWV0YWRhdGEgPSB7fSwgaW1hZ2VzID0gW10sIGZpbGVzID0gW10sIG5hbWUsIHR5cGUsIGZpbGVUeXBlLCBvdXRwdXREaXIsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+UhCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFNhdmluZyBjb252ZXJzaW9uIHJlc3VsdCBmb3IgJHtuYW1lfSAoJHt0eXBlIHx8IGZpbGVUeXBlfSlgKTtcclxuICAgIFxyXG4gICAgLy8gVmFsaWRhdGUgcmVxdWlyZWQgcGFyYW1ldGVyc1xyXG4gICAgaWYgKCFjb250ZW50KSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIGNvbnRlbnQgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29udGVudCBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCFuYW1lKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG5hbWUgcHJvdmlkZWQhJyk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcignTmFtZSBpcyByZXF1aXJlZCBmb3IgY29udmVyc2lvbiByZXN1bHQnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKCF0eXBlICYmICFmaWxlVHlwZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyB0eXBlIG9yIGZpbGVUeXBlIHByb3ZpZGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1R5cGUgb3IgZmlsZVR5cGUgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24gcmVzdWx0Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBmaWxlVHlwZSBhcyBmYWxsYmFjayBmb3IgdHlwZSBpZiB0eXBlIGlzIG5vdCBwcm92aWRlZFxyXG4gICAgY29uc3QgY29udGVudFR5cGUgPSB0eXBlIHx8IGZpbGVUeXBlO1xyXG4gICAgXHJcbiAgICBpZiAoIW91dHB1dERpcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBvdXRwdXQgZGlyZWN0b3J5IHByb3ZpZGVkIScpO1xyXG4gICAgICBjb25zb2xlLmxvZygn4pqg77iPIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gVXNpbmcgZGVmYXVsdCBvdXRwdXQgZGlyZWN0b3J5OicsIHRoaXMuZGVmYXVsdE91dHB1dERpcik7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFVzZSBwcm92aWRlZCBvdXRwdXQgZGlyZWN0b3J5IG9yIGZhbGwgYmFjayB0byBkZWZhdWx0XHJcbiAgICBjb25zdCBiYXNlT3V0cHV0RGlyID0gb3V0cHV0RGlyIHx8IHRoaXMuZGVmYXVsdE91dHB1dERpcjtcclxuICAgIFxyXG4gICAgLy8gRGV0ZXJtaW5lIGlmIHdlIHNob3VsZCBjcmVhdGUgYSBzdWJkaXJlY3RvcnlcclxuICAgIGNvbnN0IHVzZXJQcm92aWRlZE91dHB1dERpciA9ICEhb3V0cHV0RGlyO1xyXG4gICAgY29uc3QgY3JlYXRlU3ViZGlyZWN0b3J5ID0gdXNlclByb3ZpZGVkT3V0cHV0RGlyID8gZmFsc2UgOiBcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAob3B0aW9ucy5jcmVhdGVTdWJkaXJlY3RvcnkgIT09IHVuZGVmaW5lZCA/IG9wdGlvbnMuY3JlYXRlU3ViZGlyZWN0b3J5IDogdHJ1ZSk7XHJcbiAgIFxyXG4gICAvLyBHZW5lcmF0ZSBhcHByb3ByaWF0ZSBmaWxlbmFtZSBiYXNlZCBvbiB0eXBlIGFuZCBtZXRhZGF0YVxyXG4gICBjb25zdCBmaWxlbmFtZSA9IGdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZShuYW1lLCBjb250ZW50VHlwZSwgbWV0YWRhdGEpO1xyXG4gICBcclxuICAgLy8gRGV0ZXJtaW5lIFVSTCBzdGF0dXMgZm9yIHBhdGggdmFsaWRhdGlvblxyXG4gICBjb25zdCBpc1VybCA9IGNvbnRlbnRUeXBlID09PSAndXJsJyB8fCBjb250ZW50VHlwZSA9PT0gJ3BhcmVudHVybCc7XHJcblxyXG4gICAgLy8gR2V0IHRoZSBiYXNlIG5hbWUgd2l0aG91dCBleHRlbnNpb24gYW5kIGVuc3VyZSBpdCdzIHZhbGlkIGZvciB0aGUgZmlsZSBzeXN0ZW1cclxuICAgIC8vIE5vIG5lZWQgdG8gcmVwbGFjZSBzcGFjZXMgd2l0aCB1bmRlcnNjb3JlcyBvciBtYWtlIG90aGVyIGNoYW5nZXMgc2luY2UgY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSBhbHJlYWR5IGRpZCB0aGF0XHJcbiAgICBjb25zdCBiYXNlTmFtZSA9IGdldEJhc2VuYW1lKGZpbGVuYW1lKTtcclxuICAgIGNvbnNvbGUubG9nKGDwn5OdIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gVXNpbmcgYmFzZSBuYW1lOiAke2Jhc2VOYW1lfWApO1xyXG5cclxuICAgIC8vIEZvciBvdXRwdXQgZGlyZWN0b3J5IHBhdGgsIHVzZSB0aGUgYmFzZSBuYW1lIGJ1dCB3aXRob3V0IHRpbWVzdGFtcCBzdWZmaXggaW4gdGhlIGRpcmVjdG9yeSBuYW1lXHJcbiAgICAvLyBUaGUgdGltZXN0YW1wIGlzIG9ubHkgYWRkZWQgdG8gcHJldmVudCBjb2xsaXNpb25zXHJcbiAgICBjb25zdCBvdXRwdXRCYXNlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/XHJcbiAgICAgIHBhdGguam9pbihiYXNlT3V0cHV0RGlyLCBgJHtiYXNlTmFtZX1fJHtEYXRlLm5vdygpfWApIDpcclxuICAgICAgYmFzZU91dHB1dERpcjtcclxuXHJcbiAgICBjb25zb2xlLmxvZyhg8J+TgSBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIEdlbmVyYXRlZCBvdXRwdXQgcGF0aDogJHtvdXRwdXRCYXNlUGF0aH1gKTtcclxuXHJcbiAgICAvLyBDcmVhdGUgb3V0cHV0IGRpcmVjdG9yeSB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS5jcmVhdGVEaXJlY3Rvcnkob3V0cHV0QmFzZVBhdGgsIHsgaXNVcmwgfSk7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBDcmVhdGVkIG91dHB1dCBkaXJlY3Rvcnk6ICR7b3V0cHV0QmFzZVBhdGh9YCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBGYWlsZWQgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gY3JlYXRlIG91dHB1dCBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDcmVhdGUgaW1hZ2VzIGRpcmVjdG9yeSBpZiB3ZSBoYXZlIGltYWdlc1xyXG4gICAgaWYgKGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCkge1xyXG4gICAgICAvLyBHcm91cCBpbWFnZXMgYnkgdGhlaXIgZGlyZWN0b3J5IHBhdGhzXHJcbiAgICAgIGNvbnN0IGltYWdlc0J5RGlyID0gbmV3IE1hcCgpO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBpbWFnZXMpIHtcclxuICAgICAgICBpZiAoIWltYWdlIHx8ICFpbWFnZS5wYXRoKSB7XHJcbiAgICAgICAgICBjb25zb2xlLndhcm4oYOKaoO+4jyBJbnZhbGlkIGltYWdlIG9iamVjdCBvciBtaXNzaW5nIHBhdGg6YCwgaW1hZ2UpO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEV4dHJhY3QgdGhlIGRpcmVjdG9yeSBwYXJ0IGZyb20gdGhlIGltYWdlIHBhdGhcclxuICAgICAgICBjb25zdCBkaXJQYXRoID0gcGF0aC5kaXJuYW1lKGltYWdlLnBhdGgpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGlmICghaW1hZ2VzQnlEaXIuaGFzKGRpclBhdGgpKSB7XHJcbiAgICAgICAgICBpbWFnZXNCeURpci5zZXQoZGlyUGF0aCwgW10pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBpbWFnZXNCeURpci5nZXQoZGlyUGF0aCkucHVzaChpbWFnZSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIENyZWF0ZSBlYWNoIHVuaXF1ZSBkaXJlY3RvcnkgYW5kIHNhdmUgaXRzIGltYWdlc1xyXG4gICAgICBmb3IgKGNvbnN0IFtkaXJQYXRoLCBkaXJJbWFnZXNdIG9mIGltYWdlc0J5RGlyLmVudHJpZXMoKSkge1xyXG4gICAgICAgIGNvbnN0IGZ1bGxEaXJQYXRoID0gcGF0aC5qb2luKG91dHB1dEJhc2VQYXRoLCBkaXJQYXRoKTtcclxuICAgICAgICBjb25zb2xlLmxvZyhg8J+TgSBDcmVhdGluZyBpbWFnZXMgZGlyZWN0b3J5OiAke2Z1bGxEaXJQYXRofWApO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS5jcmVhdGVEaXJlY3RvcnkoZnVsbERpclBhdGgsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gU2F2ZSBpbWFnZXMgdG8gdGhlaXIgcmVzcGVjdGl2ZSBkaXJlY3Rvcmllc1xyXG4gICAgICAgIGZvciAoY29uc3QgaW1hZ2Ugb2YgZGlySW1hZ2VzKSB7XHJcbiAgICAgICAgICBpZiAoaW1hZ2UgJiYgaW1hZ2UuZGF0YSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgIGNvbnN0IGltYWdlUGF0aCA9IHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgaW1hZ2UucGF0aCk7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5sb2coYPCfkr4gU2F2aW5nIGltYWdlOiAke2ltYWdlUGF0aH1gKTtcclxuICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAvLyBFbnN1cmUgdGhlIGltYWdlIGRhdGEgaXMgaW4gdGhlIHJpZ2h0IGZvcm1hdFxyXG4gICAgICAgICAgICAgIGNvbnN0IGltYWdlRGF0YSA9IEJ1ZmZlci5pc0J1ZmZlcihpbWFnZS5kYXRhKSBcclxuICAgICAgICAgICAgICAgID8gaW1hZ2UuZGF0YSBcclxuICAgICAgICAgICAgICAgIDogKHR5cGVvZiBpbWFnZS5kYXRhID09PSAnc3RyaW5nJyAmJiBpbWFnZS5kYXRhLnN0YXJ0c1dpdGgoJ2RhdGE6JykpXHJcbiAgICAgICAgICAgICAgICAgID8gQnVmZmVyLmZyb20oaW1hZ2UuZGF0YS5zcGxpdCgnLCcpWzFdLCAnYmFzZTY0JylcclxuICAgICAgICAgICAgICAgICAgOiBCdWZmZXIuZnJvbShpbWFnZS5kYXRhLCAnYmFzZTY0Jyk7XHJcbiAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoaW1hZ2VQYXRoLCBpbWFnZURhdGEsIG51bGwsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGltYWdlRXJyb3IpIHtcclxuICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgaW1hZ2U6ICR7aW1hZ2UucGF0aH1gLCBpbWFnZUVycm9yKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3Q6YCwgaW1hZ2UpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIERldGVybWluZSBtYWluIGZpbGUgcGF0aCAtIHVzZSBiYXNlTmFtZSBpbnN0ZWFkIG9mIGhhcmRjb2RlZCAnZG9jdW1lbnQubWQnXHJcbiAgICAvLyBUaGlzIGVuc3VyZXMgdGhlIG9yaWdpbmFsIGZpbGVuYW1lIGlzIHByZXNlcnZlZCBldmVuIHdoZW4gY3JlYXRpbmcgYSBzdWJkaXJlY3RvcnlcclxuICAgIGNvbnN0IG1haW5GaWxlUGF0aCA9IGNyZWF0ZVN1YmRpcmVjdG9yeSA/XHJcbiAgICAgIHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgYCR7YmFzZU5hbWV9Lm1kYCkgOlxyXG4gICAgICBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGAke2Jhc2VOYW1lfS5tZGApO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBpbWFnZSByZWZlcmVuY2VzIHRvIHVzZSBPYnNpZGlhbiBmb3JtYXRcclxuICAgIGNvbnN0IHVwZGF0ZWRDb250ZW50ID0gdGhpcy51cGRhdGVJbWFnZVJlZmVyZW5jZXMoY29udGVudCwgaW1hZ2VzKTtcclxuXHJcbiAgICAvLyBDbGVhbiBtZXRhZGF0YSBmaWVsZHMgYW5kIGNyZWF0ZSBtZXRhZGF0YSBvYmplY3RcclxuICAgIGNvbnN0IGZ1bGxNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsIC8vIEVuc3VyZSBmaWxlVHlwZSBpcyBpbmNsdWRlZCBpbiBtZXRhZGF0YVxyXG4gICAgICBjb252ZXJ0ZWQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcclxuICAgICAgLi4ubWV0YWRhdGFcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgYW5kIG1lcmdlIGZyb250bWF0dGVyIGlmIGl0IGV4aXN0c1xyXG4gICAgY29uc3QgeyBtZXRhZGF0YTogZXhpc3RpbmdNZXRhZGF0YSwgY29udGVudDogY29udGVudFdpdGhvdXRGcm9udG1hdHRlciB9ID0gZXh0cmFjdEZyb250bWF0dGVyKHVwZGF0ZWRDb250ZW50KTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5OdIEV4dHJhY3RlZCBleGlzdGluZyBmcm9udG1hdHRlcjonLCBleGlzdGluZ01ldGFkYXRhKTtcclxuICAgIFxyXG4gICAgLy8gTWVyZ2UgbWV0YWRhdGEgdXNpbmcgc2hhcmVkIHV0aWxpdHlcclxuICAgIGNvbnN0IG1lcmdlZE1ldGFkYXRhID0gbWVyZ2VNZXRhZGF0YShleGlzdGluZ01ldGFkYXRhLCBmdWxsTWV0YWRhdGEsIHtcclxuICAgICAgdHlwZTogZnVsbE1ldGFkYXRhLnR5cGUsIC8vIEVuc3VyZSB0eXBlIGZyb20gZnVsbE1ldGFkYXRhIHRha2VzIHByZWNlZGVuY2VcclxuICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgLy8gQWx3YXlzIHVzZSBjdXJyZW50IHRpbWVzdGFtcFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEZvcm1hdCBhbmQgY29tYmluZSB3aXRoIGNvbnRlbnRcclxuICAgIGNvbnN0IGZyb250bWF0dGVyID0gZm9ybWF0TWV0YWRhdGEobWVyZ2VkTWV0YWRhdGEpO1xyXG4gICAgY29uc3QgZnVsbENvbnRlbnQgPSBmcm9udG1hdHRlciArIGNvbnRlbnRXaXRob3V0RnJvbnRtYXR0ZXI7XHJcblxyXG4gICAgLy8gU2F2ZSB0aGUgbWFya2Rvd24gY29udGVudCB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUobWFpbkZpbGVQYXRoLCBmdWxsQ29udGVudCwgJ3V0ZjgnLCB7IGlzVXJsIH0pO1xyXG5cclxuICAgIC8vIEhhbmRsZSBhZGRpdGlvbmFsIGZpbGVzIGlmIHByb3ZpZGVkIChmb3IgbXVsdGktZmlsZSBjb252ZXJzaW9ucyBsaWtlIHBhcmVudHVybClcclxuICAgIGlmIChmaWxlcyAmJiBBcnJheS5pc0FycmF5KGZpbGVzKSAmJiBmaWxlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gUHJvY2Vzc2luZyAke2ZpbGVzLmxlbmd0aH0gYWRkaXRpb25hbCBmaWxlc2ApO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgaWYgKCFmaWxlIHx8ICFmaWxlLm5hbWUgfHwgIWZpbGUuY29udGVudCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBmaWxlIG9iamVjdDpgLCBmaWxlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRW5zdXJlIHRoZSBkaXJlY3RvcnkgZXhpc3RzXHJcbiAgICAgICAgICBjb25zdCBmaWxlRGlyUGF0aCA9IHBhdGguZGlybmFtZShwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSkpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShmaWxlRGlyUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gU2F2ZSB0aGUgZmlsZVxyXG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBTYXZpbmcgYWRkaXRpb25hbCBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgd2UgbmVlZCB0byBhZGQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgIGxldCBmaWxlQ29udGVudCA9IGZpbGUuY29udGVudDtcclxuICAgICAgICAgIGlmIChmaWxlLnR5cGUgPT09ICd0ZXh0JyAmJiAhZmlsZUNvbnRlbnQudHJpbSgpLnN0YXJ0c1dpdGgoJy0tLScpKSB7XHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBtZXRhZGF0YSBmb3IgdGhpcyBmaWxlXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICAgICAgICAgIHR5cGU6IGZpbGUudHlwZSB8fCAndGV4dCcsXHJcbiAgICAgICAgICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICAgICAgLi4uKGZpbGUubWV0YWRhdGEgfHwge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGZyb250bWF0dGVyXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVGcm9udG1hdHRlciA9IGZvcm1hdE1ldGFkYXRhKGZpbGVNZXRhZGF0YSk7XHJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ID0gZmlsZUZyb250bWF0dGVyICsgZmlsZUNvbnRlbnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50LCAndXRmOCcsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZmlsZUVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgZmlsZTogJHtmaWxlLm5hbWV9YCwgZmlsZUVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgdGhlIHJlc3VsdCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+SviBDb252ZXJzaW9uIHJlc3VsdCBzYXZlZDonLCB7XHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoLFxyXG4gICAgICBoYXNJbWFnZXM6IGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCxcclxuICAgICAgaW1hZ2VDb3VudDogaW1hZ2VzID8gaW1hZ2VzLmxlbmd0aCA6IDAsXHJcbiAgICAgIGFkZGl0aW9uYWxGaWxlczogZmlsZXMgPyBmaWxlcy5sZW5ndGggOiAwLFxyXG4gICAgICBjb250ZW50TGVuZ3RoOiBmdWxsQ29udGVudC5sZW5ndGhcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpXHJcbiAgICBjb25zdCBpc0RhdGFGaWxlID0gY29udGVudFR5cGUgPT09ICdjc3YnIHx8IGNvbnRlbnRUeXBlID09PSAneGxzeCcgfHxcclxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVUeXBlID09PSAnY3N2JyB8fCBmaWxlVHlwZSA9PT0gJ3hsc3gnO1xyXG4gICAgaWYgKGlzRGF0YUZpbGUpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGU6ICR7dHlwZX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGFsbCByZXF1aXJlZCBwcm9wZXJ0aWVzIGZvciBkYXRhIGZpbGVzXHJcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7XHJcbiAgICAgICAgbWV0YWRhdGEuZm9ybWF0ID0gdHlwZTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKCFtZXRhZGF0YS50eXBlKSB7XHJcbiAgICAgICAgbWV0YWRhdGEudHlwZSA9ICdzcHJlYWRzaGVldCc7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBhZGRpdGlvbmFsIGxvZ2dpbmcgZm9yIGRhdGEgZmlsZXNcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBEYXRhIGZpbGUgbWV0YWRhdGE6YCwgbWV0YWRhdGEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgd2UgaGF2ZSBhIHZhbGlkIG91dHB1dCBwYXRoXHJcbiAgICBpZiAoIW91dHB1dEJhc2VQYXRoKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG91dHB1dCBwYXRoIGdlbmVyYXRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgb3V0cHV0IHBhdGgnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gUmV0dXJuIHN0YW5kYXJkaXplZCByZXN1bHQgd2l0aCBndWFyYW50ZWVkIG91dHB1dFBhdGhcclxuICAgIGNvbnN0IHJlc3VsdCA9IHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGgsXHJcbiAgICAgIG1ldGFkYXRhOiBmdWxsTWV0YWRhdGFcclxuICAgIH07XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTdWNjZXNzZnVsbHkgc2F2ZWQgY29udmVyc2lvbiByZXN1bHQ6YCwge1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsXHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUUsUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdILE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDeEUsTUFBTTtFQUFFSSxjQUFjO0VBQUVDLGFBQWE7RUFBRUMsa0JBQWtCO0VBQUVDO0FBQWMsQ0FBQyxHQUFHUCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDekcsTUFBTTtFQUFFUSxzQkFBc0I7RUFBRUMsV0FBVztFQUFFQztBQUFv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