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

    // Create standardized metadata using the centralized utility
    const {
      createStandardMetadata
    } = require('../converters/utils/metadata');
    const fullMetadata = createStandardMetadata({
      title: metadata.title || baseName,
      fileType: contentType,
      convertedDate: new Date()
    });

    // Add any additional metadata fields that aren't part of the standard set
    const additionalMetadata = {
      ...metadata
    };
    delete additionalMetadata.title;
    delete additionalMetadata.fileType;
    delete additionalMetadata.converted;
    delete additionalMetadata.type;
    delete additionalMetadata.originalFileName; // Don't include originalFileName in frontmatter

    // Merge additional metadata
    Object.assign(fullMetadata, additionalMetadata);

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsImluc3RhbmNlIiwiRmlsZVN5c3RlbVNlcnZpY2UiLCJmb3JtYXRNZXRhZGF0YSIsImNsZWFuTWV0YWRhdGEiLCJleHRyYWN0RnJvbnRtYXR0ZXIiLCJtZXJnZU1ldGFkYXRhIiwiY2xlYW5UZW1wb3JhcnlGaWxlbmFtZSIsImdldEJhc2VuYW1lIiwiZ2VuZXJhdGVVcmxGaWxlbmFtZSIsImdlbmVyYXRlQXBwcm9wcmlhdGVGaWxlbmFtZSIsIm9yaWdpbmFsTmFtZSIsInR5cGUiLCJtZXRhZGF0YSIsImNvbnNvbGUiLCJsb2ciLCJzb3VyY2VfdXJsIiwib3JpZ2luYWxGaWxlTmFtZSIsIk9iamVjdCIsImtleXMiLCJqb2luIiwic2FmZUZpbGVuYW1lIiwid2FybiIsImNsZWFuZWROYW1lIiwiZXNjYXBlUmVnRXhwIiwic3RyaW5nIiwidW5kZWZpbmVkIiwicmVwbGFjZSIsImVycm9yIiwiaXNVcmwiLCJzdGFydHNXaXRoIiwiQ29udmVyc2lvblJlc3VsdE1hbmFnZXIiLCJjb25zdHJ1Y3RvciIsImZpbGVTeXN0ZW0iLCJkZWZhdWx0T3V0cHV0RGlyIiwiZ2V0UGF0aCIsInVwZGF0ZUltYWdlUmVmZXJlbmNlcyIsImNvbnRlbnQiLCJpbWFnZXMiLCJBcnJheSIsImlzQXJyYXkiLCJsZW5ndGgiLCJ1cGRhdGVkQ29udGVudCIsImdlbmVyaWNNYXJrZG93blBhdHRlcm4iLCJwcm9jZXNzZWRJbWFnZUlkcyIsIlNldCIsImltYWdlUGF0aHMiLCJNYXAiLCJmb3JFYWNoIiwiaW1hZ2UiLCJpbWFnZVBhdGgiLCJuYW1lIiwic3JjIiwic2V0IiwiYmFzZW5hbWUiLCJtYXRjaCIsImFsdCIsImltYWdlSWQiLCJoYXMiLCJnZXQiLCJhZGQiLCJtYXJrZG93blBhdHRlcm4iLCJSZWdFeHAiLCJtYXJrZG93bkFueVBhdHRlcm4iLCJvYnNpZGlhblBhdHRlcm4iLCJjb3JyZWN0T2JzaWRpYW5Gb3JtYXQiLCJpbmNsdWRlcyIsIm1hdGNoZXMiLCJtYXRjaFBhdGgiLCJzdWJzdHJpbmciLCJleHRuYW1lIiwiaW1hZ2VFcnJvciIsImV4dHJhY3RlZEltYWdlc1BhdHRlcm4iLCJzYXZlQ29udmVyc2lvblJlc3VsdCIsImZpbGVzIiwiZmlsZVR5cGUiLCJvdXRwdXREaXIiLCJvcHRpb25zIiwiRXJyb3IiLCJjb250ZW50VHlwZSIsImJhc2VPdXRwdXREaXIiLCJ1c2VyUHJvdmlkZWRPdXRwdXREaXIiLCJjcmVhdGVTdWJkaXJlY3RvcnkiLCJmaWxlbmFtZSIsImJhc2VOYW1lIiwib3V0cHV0QmFzZVBhdGgiLCJEYXRlIiwibm93IiwiY3JlYXRlRGlyZWN0b3J5IiwibWVzc2FnZSIsImltYWdlc0J5RGlyIiwiZGlyUGF0aCIsImRpcm5hbWUiLCJwdXNoIiwiZGlySW1hZ2VzIiwiZW50cmllcyIsImZ1bGxEaXJQYXRoIiwiZGF0YSIsImltYWdlRGF0YSIsIkJ1ZmZlciIsImlzQnVmZmVyIiwiZnJvbSIsInNwbGl0Iiwid3JpdGVGaWxlIiwibWFpbkZpbGVQYXRoIiwiY3JlYXRlU3RhbmRhcmRNZXRhZGF0YSIsImZ1bGxNZXRhZGF0YSIsInRpdGxlIiwiY29udmVydGVkRGF0ZSIsImFkZGl0aW9uYWxNZXRhZGF0YSIsImNvbnZlcnRlZCIsImFzc2lnbiIsImV4aXN0aW5nTWV0YWRhdGEiLCJjb250ZW50V2l0aG91dEZyb250bWF0dGVyIiwibWVyZ2VkTWV0YWRhdGEiLCJ0b0lTT1N0cmluZyIsImZyb250bWF0dGVyIiwiZnVsbENvbnRlbnQiLCJmaWxlIiwiZmlsZURpclBhdGgiLCJmaWxlUGF0aCIsImZpbGVDb250ZW50IiwidHJpbSIsImZpbGVNZXRhZGF0YSIsImZpbGVGcm9udG1hdHRlciIsImZpbGVFcnJvciIsIm91dHB1dFBhdGgiLCJtYWluRmlsZSIsImhhc0ltYWdlcyIsImltYWdlQ291bnQiLCJhZGRpdGlvbmFsRmlsZXMiLCJjb250ZW50TGVuZ3RoIiwiaXNEYXRhRmlsZSIsImZvcm1hdCIsInJlc3VsdCIsInN1Y2Nlc3MiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBDb252ZXJzaW9uUmVzdWx0TWFuYWdlci5qc1xyXG4gKiBcclxuICogSGFuZGxlcyBzYXZpbmcgY29udmVyc2lvbiByZXN1bHRzIHRvIGRpc2sgd2l0aCBjb25zaXN0ZW50IGZpbGUgaGFuZGxpbmcuXHJcbiAqIE1hbmFnZXMgb3V0cHV0IGRpcmVjdG9yeSBzdHJ1Y3R1cmUsIGltYWdlIHNhdmluZywgYW5kIG1ldGFkYXRhIGZvcm1hdHRpbmcuXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9FbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBVc2VzIHRoaXMgc2VydmljZSBmb3Igc2F2aW5nIGNvbnZlcnNpb24gcmVzdWx0c1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9GaWxlU3lzdGVtU2VydmljZS5qczogVXNlZCBmb3IgZmlsZSBzeXN0ZW0gb3BlcmF0aW9uc1xyXG4gKiAtIHNyYy9lbGVjdHJvbi9hZGFwdGVycy9tZXRhZGF0YUV4dHJhY3RvckFkYXB0ZXIuanM6IFVzZWQgZm9yIG1ldGFkYXRhIGZvcm1hdHRpbmdcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTsgLy8gSW1wb3J0IGluc3RhbmNlXHJcbmNvbnN0IHsgZm9ybWF0TWV0YWRhdGEsIGNsZWFuTWV0YWRhdGEsIGV4dHJhY3RGcm9udG1hdHRlciwgbWVyZ2VNZXRhZGF0YSB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvbWFya2Rvd24nKTtcclxuY29uc3QgeyBjbGVhblRlbXBvcmFyeUZpbGVuYW1lLCBnZXRCYXNlbmFtZSwgZ2VuZXJhdGVVcmxGaWxlbmFtZSB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvZmlsZXMnKTtcclxuXHJcbi8qKlxyXG4gKiBHZW5lcmF0ZSBhcHByb3ByaWF0ZSBmaWxlbmFtZSBiYXNlZCBvbiBjb252ZXJzaW9uIHR5cGUgYW5kIG1ldGFkYXRhXHJcbiAqIEBwcml2YXRlXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBvcmlnaW5hbE5hbWUgLSBPcmlnaW5hbCBmaWxlbmFtZSBvciBVUkxcclxuICogQHBhcmFtIHtzdHJpbmd9IHR5cGUgLSBUeXBlIG9mIGNvbnZlcnNpb24gKGUuZy4sICd1cmwnLCAncGRmJylcclxuICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gTWV0YWRhdGEgZnJvbSBjb252ZXJzaW9uXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBhcHByb3ByaWF0ZSBmaWxlbmFtZVxyXG4gKi9cclxuZnVuY3Rpb24gZ2VuZXJhdGVBcHByb3ByaWF0ZUZpbGVuYW1lKG9yaWdpbmFsTmFtZSwgdHlwZSwgbWV0YWRhdGEgPSB7fSkge1xyXG4gIGNvbnNvbGUubG9nKGDwn5SEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gR2VuZXJhdGluZyBmaWxlbmFtZSBmb3I6ICR7b3JpZ2luYWxOYW1lfSAoJHt0eXBlfSlgKTtcclxuXHJcbiAgLy8gRm9yIFVSTCBjb252ZXJzaW9ucywgZ2VuZXJhdGUgZnJvbSB0aGUgc291cmNlIFVSTCBpZiBhdmFpbGFibGVcclxuICBpZiAodHlwZSA9PT0gJ3VybCcgJiYgbWV0YWRhdGEuc291cmNlX3VybCkge1xyXG4gICAgcmV0dXJuIGdlbmVyYXRlVXJsRmlsZW5hbWUobWV0YWRhdGEuc291cmNlX3VybCk7XHJcbiAgfVxyXG5cclxuICAvLyBGb3IgRXhjZWwgYW5kIGRhdGEgZmlsZXMsIHByaW9yaXRpemUgb3JpZ2luYWxGaWxlTmFtZSBmcm9tIG1ldGFkYXRhXHJcbiAgaWYgKHR5cGUgPT09ICd4bHN4JyB8fCB0eXBlID09PSAnY3N2Jykge1xyXG4gICAgLy8gVXNlIHRoZSBtZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lIGlmIGF2YWlsYWJsZSAoYWRkZWQgaW4gb3VyIGZpeCB0byBjb252ZXJ0ZXJzKVxyXG4gICAgaWYgKG1ldGFkYXRhLm9yaWdpbmFsRmlsZU5hbWUpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBVc2luZyBvcmlnaW5hbEZpbGVOYW1lIGZyb20gbWV0YWRhdGE6ICR7bWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZX1gKTtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBBdmFpbGFibGUgbWV0YWRhdGEga2V5czogJHtPYmplY3Qua2V5cyhtZXRhZGF0YSkuam9pbignLCAnKX1gKTtcclxuXHJcbiAgICAgIC8vIFByZXNlcnZlIHRoZSBjb21wbGV0ZSBvcmlnaW5hbCBmaWxlbmFtZSAoaW5jbHVkaW5nIG51bWJlcnMgYW5kIHNwZWNpYWwgY2hhcmFjdGVycylcclxuICAgICAgLy8gT25seSByZXBsYWNlIGNoYXJhY3RlcnMgdGhhdCBhcmUgaW52YWxpZCBmb3IgdGhlIGZpbGVzeXN0ZW1cclxuICAgICAgY29uc3Qgc2FmZUZpbGVuYW1lID0gY2xlYW5UZW1wb3JhcnlGaWxlbmFtZShtZXRhZGF0YS5vcmlnaW5hbEZpbGVOYW1lKTtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBQcmVzZXJ2aW5nIGZ1bGwgb3JpZ2luYWwgZmlsZW5hbWU6ICR7bWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZX0gLT4gJHtzYWZlRmlsZW5hbWV9YCk7XHJcbiAgICAgIHJldHVybiBzYWZlRmlsZW5hbWU7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gTG9nIGlmIG9yaWdpbmFsRmlsZU5hbWUgaXMgbWlzc2luZyBmb3Igc3ByZWFkc2hlZXQgZmlsZXNcclxuICAgIGNvbnNvbGUud2Fybihg4pqg77iPIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gb3JpZ2luYWxGaWxlTmFtZSBmb3VuZCBpbiBtZXRhZGF0YSBmb3IgJHt0eXBlfSBmaWxlLiBNZXRhZGF0YSBrZXlzOiAke09iamVjdC5rZXlzKG1ldGFkYXRhKS5qb2luKCcsICcpfWApO1xyXG4gICAgY29uc29sZS53YXJuKGDimqDvuI8gW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBVc2luZyBmYWxsYmFjazogJHtvcmlnaW5hbE5hbWV9YCk7XHJcbiAgfVxyXG5cclxuICAvLyBGb3IgYWxsIG90aGVyIGZpbGVzLCBjbGVhbiB0aGUgb3JpZ2luYWwgbmFtZVxyXG4gIGNvbnN0IGNsZWFuZWROYW1lID0gY2xlYW5UZW1wb3JhcnlGaWxlbmFtZShvcmlnaW5hbE5hbWUpO1xyXG4gIGNvbnNvbGUubG9nKGDwn5OEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gR2VuZXJhdGVkIGZpbGVuYW1lOiAke2NsZWFuZWROYW1lfWApO1xyXG4gIHJldHVybiBjbGVhbmVkTmFtZTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEhlbHBlciBmdW5jdGlvbiB0byBlc2NhcGUgc3BlY2lhbCBjaGFyYWN0ZXJzIGluIHJlZ3VsYXIgZXhwcmVzc2lvbnNcclxuICogQHBhcmFtIHtzdHJpbmd9IHN0cmluZyAtIFRoZSBzdHJpbmcgdG8gZXNjYXBlXHJcbiAqIEByZXR1cm5zIHtzdHJpbmd9IFRoZSBlc2NhcGVkIHN0cmluZ1xyXG4gKi9cclxuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHN0cmluZykge1xyXG4gIC8vIEhhbmRsZSBudWxsLCB1bmRlZmluZWQsIG9yIG5vbi1zdHJpbmcgaW5wdXRzXHJcbiAgaWYgKHN0cmluZyA9PT0gbnVsbCB8fCBzdHJpbmcgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2Ygc3RyaW5nICE9PSAnc3RyaW5nJykge1xyXG4gICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBpbnB1dCB0byBlc2NhcGVSZWdFeHA6ICR7c3RyaW5nfWApO1xyXG4gICAgcmV0dXJuICcnO1xyXG4gIH1cclxuICBcclxuICB0cnkge1xyXG4gICAgcmV0dXJuIHN0cmluZy5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpO1xyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICBjb25zb2xlLmVycm9yKGDinYwgRXJyb3IgaW4gZXNjYXBlUmVnRXhwOmAsIGVycm9yKTtcclxuICAgIHJldHVybiAnJztcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBIZWxwZXIgZnVuY3Rpb24gdG8gY2hlY2sgaWYgYSBwYXRoIGlzIGEgVVJMXHJcbiAqIEBwYXJhbSB7c3RyaW5nfSBwYXRoIC0gVGhlIHBhdGggdG8gY2hlY2tcclxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIHBhdGggaXMgYSBVUkxcclxuICovXHJcbmZ1bmN0aW9uIGlzVXJsKHBhdGgpIHtcclxuICByZXR1cm4gdHlwZW9mIHBhdGggPT09ICdzdHJpbmcnICYmIChwYXRoLnN0YXJ0c1dpdGgoJ2h0dHA6Ly8nKSB8fCBwYXRoLnN0YXJ0c1dpdGgoJ2h0dHBzOi8vJykpO1xyXG59XHJcblxyXG5jbGFzcyBDb252ZXJzaW9uUmVzdWx0TWFuYWdlciB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTtcclxuICAgIHRoaXMuZGVmYXVsdE91dHB1dERpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NvbnZlcnNpb25zJyk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCdDb252ZXJzaW9uUmVzdWx0TWFuYWdlciBpbml0aWFsaXplZCB3aXRoIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeTonLCB0aGlzLmRlZmF1bHRPdXRwdXREaXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVXBkYXRlIGltYWdlIHJlZmVyZW5jZXMgdG8gdXNlIE9ic2lkaWFuIGZvcm1hdFxyXG4gICAqIEBwcml2YXRlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnRlbnQgLSBUaGUgY29udGVudCB0byB1cGRhdGVcclxuICAgKiBAcGFyYW0ge0FycmF5fSBpbWFnZXMgLSBBcnJheSBvZiBpbWFnZSBvYmplY3RzXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gVXBkYXRlZCBjb250ZW50IHdpdGggT2JzaWRpYW4gaW1hZ2UgcmVmZXJlbmNlc1xyXG4gICAqL1xyXG4gIHVwZGF0ZUltYWdlUmVmZXJlbmNlcyhjb250ZW50LCBpbWFnZXMpIHtcclxuICAgIC8vIFZhbGlkYXRlIGlucHV0c1xyXG4gICAgaWYgKCFjb250ZW50IHx8IHR5cGVvZiBjb250ZW50ICE9PSAnc3RyaW5nJykge1xyXG4gICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBJbnZhbGlkIGNvbnRlbnQgcHJvdmlkZWQgdG8gdXBkYXRlSW1hZ2VSZWZlcmVuY2VzJyk7XHJcbiAgICAgIHJldHVybiBjb250ZW50IHx8ICcnO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAoIWltYWdlcyB8fCAhQXJyYXkuaXNBcnJheShpbWFnZXMpIHx8IGltYWdlcy5sZW5ndGggPT09IDApIHtcclxuICAgICAgcmV0dXJuIGNvbnRlbnQ7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGxldCB1cGRhdGVkQ29udGVudCA9IGNvbnRlbnQ7XHJcbiAgICBcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIEZpcnN0LCBoYW5kbGUgYW55IGdlbmVyaWMgc3RhbmRhcmQgTWFya2Rvd24gaW1hZ2UgbGlua3MgdGhhdCBtaWdodCBub3QgYmUgYXNzb2NpYXRlZCB3aXRoIG91ciBpbWFnZXNcclxuICAgICAgLy8gVGhpcyBpcyBlc3BlY2lhbGx5IGltcG9ydGFudCBmb3IgTWlzdHJhbCBPQ1IgcmVzdWx0c1xyXG4gICAgICBjb25zdCBnZW5lcmljTWFya2Rvd25QYXR0ZXJuID0gLyFcXFsoLio/KVxcXVxcKCguKj8pXFwpL2c7XHJcbiAgICAgIGNvbnN0IHByb2Nlc3NlZEltYWdlSWRzID0gbmV3IFNldCgpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ3JlYXRlIGEgbWFwIG9mIGltYWdlIHBhdGhzIGZvciBxdWljayBsb29rdXBcclxuICAgICAgY29uc3QgaW1hZ2VQYXRocyA9IG5ldyBNYXAoKTtcclxuICAgICAgaW1hZ2VzLmZvckVhY2goaW1hZ2UgPT4ge1xyXG4gICAgICAgIGlmIChpbWFnZSAmJiB0eXBlb2YgaW1hZ2UgPT09ICdvYmplY3QnKSB7XHJcbiAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBpbWFnZS5wYXRoIHx8IGltYWdlLm5hbWUgfHwgKGltYWdlLnNyYyA/IGltYWdlLnNyYyA6IG51bGwpO1xyXG4gICAgICAgICAgaWYgKGltYWdlUGF0aCkge1xyXG4gICAgICAgICAgICAvLyBTdG9yZSBib3RoIHRoZSBmdWxsIHBhdGggYW5kIHRoZSBiYXNlbmFtZSBmb3IgbWF0Y2hpbmdcclxuICAgICAgICAgICAgaW1hZ2VQYXRocy5zZXQoaW1hZ2VQYXRoLCBpbWFnZVBhdGgpO1xyXG4gICAgICAgICAgICBpbWFnZVBhdGhzLnNldChwYXRoLmJhc2VuYW1lKGltYWdlUGF0aCksIGltYWdlUGF0aCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIFJlcGxhY2UgZ2VuZXJpYyBNYXJrZG93biBpbWFnZSBsaW5rcyB3aXRoIE9ic2lkaWFuIGZvcm1hdCBpZiB3ZSBoYXZlIGEgbWF0Y2hpbmcgaW1hZ2VcclxuICAgICAgLy8gQnV0IHByZXNlcnZlIFVSTCBpbWFnZXMgaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShnZW5lcmljTWFya2Rvd25QYXR0ZXJuLCAobWF0Y2gsIGFsdCwgc3JjKSA9PiB7XHJcbiAgICAgICAgLy8gSWYgaXQncyBhIFVSTCwga2VlcCBpdCBpbiBzdGFuZGFyZCBNYXJrZG93biBmb3JtYXRcclxuICAgICAgICBpZiAoaXNVcmwoc3JjKSkge1xyXG4gICAgICAgICAgcmV0dXJuIG1hdGNoO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBFeHRyYWN0IHRoZSBpbWFnZSBJRCBmcm9tIHRoZSBzcmNcclxuICAgICAgICBjb25zdCBpbWFnZUlkID0gcGF0aC5iYXNlbmFtZShzcmMpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIElmIHdlIGhhdmUgYSBtYXRjaGluZyBpbWFnZSwgdXNlIHRoZSBPYnNpZGlhbiBmb3JtYXRcclxuICAgICAgICBpZiAoaW1hZ2VQYXRocy5oYXMoaW1hZ2VJZCkgfHwgaW1hZ2VQYXRocy5oYXMoc3JjKSkge1xyXG4gICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gaW1hZ2VQYXRocy5nZXQoaW1hZ2VJZCkgfHwgaW1hZ2VQYXRocy5nZXQoc3JjKTtcclxuICAgICAgICAgIHByb2Nlc3NlZEltYWdlSWRzLmFkZChpbWFnZUlkKTtcclxuICAgICAgICAgIHJldHVybiBgIVtbJHtpbWFnZVBhdGh9XV1gO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBPdGhlcndpc2UsIGtlZXAgdGhlIG9yaWdpbmFsIHJlZmVyZW5jZVxyXG4gICAgICAgIHJldHVybiBtYXRjaDtcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBOb3cgcHJvY2VzcyBlYWNoIGltYWdlIHNwZWNpZmljYWxseVxyXG4gICAgICBpbWFnZXMuZm9yRWFjaChpbWFnZSA9PiB7XHJcbiAgICAgICAgLy8gU2tpcCBpbnZhbGlkIGltYWdlIG9iamVjdHNcclxuICAgICAgICBpZiAoIWltYWdlIHx8IHR5cGVvZiBpbWFnZSAhPT0gJ29iamVjdCcpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2Fybign4pqg77iPIEludmFsaWQgaW1hZ2Ugb2JqZWN0IGluIHVwZGF0ZUltYWdlUmVmZXJlbmNlczonLCBpbWFnZSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAvLyBEZXRlcm1pbmUgdGhlIGltYWdlIHBhdGggdG8gdXNlXHJcbiAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBpbWFnZS5wYXRoIHx8IGltYWdlLm5hbWUgfHwgKGltYWdlLnNyYyA/IGltYWdlLnNyYyA6IG51bGwpO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICBpZiAoIWltYWdlUGF0aCkge1xyXG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ+KaoO+4jyBJbWFnZSBvYmplY3QgaGFzIG5vIHBhdGgsIG5hbWUsIG9yIHNyYzonLCBpbWFnZSk7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gU2tpcCBpZiB3ZSBhbHJlYWR5IHByb2Nlc3NlZCB0aGlzIGltYWdlIGluIHRoZSBnZW5lcmljIHBhc3NcclxuICAgICAgICAgIGNvbnN0IGltYWdlSWQgPSBwYXRoLmJhc2VuYW1lKGltYWdlUGF0aCk7XHJcbiAgICAgICAgICBpZiAocHJvY2Vzc2VkSW1hZ2VJZHMuaGFzKGltYWdlSWQpKSB7XHJcbiAgICAgICAgICAgIHJldHVybjtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gRmlyc3QgcmVwbGFjZSBzdGFuZGFyZCBtYXJrZG93biBpbWFnZSBzeW50YXhcclxuICAgICAgICAgIGlmIChpbWFnZS5zcmMpIHtcclxuICAgICAgICAgICAgLy8gU2tpcCBVUkwgaW1hZ2VzIC0ga2VlcCB0aGVtIGluIHN0YW5kYXJkIE1hcmtkb3duIGZvcm1hdFxyXG4gICAgICAgICAgICBpZiAoIWlzVXJsKGltYWdlLnNyYykpIHtcclxuICAgICAgICAgICAgICBjb25zdCBtYXJrZG93blBhdHRlcm4gPSBuZXcgUmVnRXhwKGAhXFxcXFtbXlxcXFxdXSpcXFxcXVxcXFwoJHtlc2NhcGVSZWdFeHAoaW1hZ2Uuc3JjKX1bXildKlxcXFwpYCwgJ2cnKTtcclxuICAgICAgICAgICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UobWFya2Rvd25QYXR0ZXJuLCBgIVtbJHtpbWFnZVBhdGh9XV1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBSZXBsYWNlIHN0YW5kYXJkIG1hcmtkb3duIGltYWdlIHN5bnRheCB3aXRoIGFueSBwYXRoXHJcbiAgICAgICAgICAvLyBTa2lwIFVSTCBpbWFnZXMgLSBrZWVwIHRoZW0gaW4gc3RhbmRhcmQgTWFya2Rvd24gZm9ybWF0XHJcbiAgICAgICAgICBpZiAoIWlzVXJsKGltYWdlUGF0aCkpIHtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd25BbnlQYXR0ZXJuID0gbmV3IFJlZ0V4cChgIVxcXFxbW15cXFxcXV0qXFxcXF1cXFxcKCR7ZXNjYXBlUmVnRXhwKGltYWdlUGF0aCl9W14pXSpcXFxcKWAsICdnJyk7XHJcbiAgICAgICAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShtYXJrZG93bkFueVBhdHRlcm4sIGAhW1ske2ltYWdlUGF0aH1dXWApO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBSZXBsYWNlIGFueSBleGlzdGluZyBPYnNpZGlhbiBzeW50YXggdGhhdCBkb2Vzbid0IG1hdGNoIG91ciBleHBlY3RlZCBmb3JtYXRcclxuICAgICAgICAgIGNvbnN0IG9ic2lkaWFuUGF0dGVybiA9IG5ldyBSZWdFeHAoYCFcXFxcW1xcXFxbW15cXFxcXV0qXFxcXF1cXFxcXWAsICdnJyk7XHJcbiAgICAgICAgICAvLyBPbmx5IHJlcGxhY2UgaWYgaXQncyBub3QgYWxyZWFkeSBpbiB0aGUgY29ycmVjdCBmb3JtYXQgYW5kIG5vdCBhIFVSTFxyXG4gICAgICAgICAgaWYgKCFpc1VybChpbWFnZVBhdGgpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvcnJlY3RPYnNpZGlhbkZvcm1hdCA9IGAhW1ske2ltYWdlUGF0aH1dXWA7XHJcbiAgICAgICAgICAgIGlmICghdXBkYXRlZENvbnRlbnQuaW5jbHVkZXMoY29ycmVjdE9ic2lkaWFuRm9ybWF0KSkge1xyXG4gICAgICAgICAgICAgIC8vIEZpbmQgYWxsIE9ic2lkaWFuIGltYWdlIHJlZmVyZW5jZXNcclxuICAgICAgICAgICAgICBjb25zdCBtYXRjaGVzID0gdXBkYXRlZENvbnRlbnQubWF0Y2gob2JzaWRpYW5QYXR0ZXJuKTtcclxuICAgICAgICAgICAgICBpZiAobWF0Y2hlcykge1xyXG4gICAgICAgICAgICAgICAgLy8gUmVwbGFjZSBvbmx5IHRob3NlIHRoYXQgY29udGFpbiBwYXJ0cyBvZiBvdXIgaW1hZ2UgcGF0aFxyXG4gICAgICAgICAgICAgICAgbWF0Y2hlcy5mb3JFYWNoKG1hdGNoID0+IHtcclxuICAgICAgICAgICAgICAgICAgLy8gRXh0cmFjdCB0aGUgcGF0aCBmcm9tIHRoZSBtYXRjaFxyXG4gICAgICAgICAgICAgICAgICBjb25zdCBtYXRjaFBhdGggPSBtYXRjaC5zdWJzdHJpbmcoMywgbWF0Y2gubGVuZ3RoIC0gMik7XHJcbiAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiB0aGlzIG1hdGNoIGlzIHJlbGF0ZWQgdG8gb3VyIGltYWdlXHJcbiAgICAgICAgICAgICAgICAgIGlmIChtYXRjaFBhdGguaW5jbHVkZXMocGF0aC5iYXNlbmFtZShpbWFnZVBhdGgsIHBhdGguZXh0bmFtZShpbWFnZVBhdGgpKSkpIHtcclxuICAgICAgICAgICAgICAgICAgICB1cGRhdGVkQ29udGVudCA9IHVwZGF0ZWRDb250ZW50LnJlcGxhY2UobWF0Y2gsIGNvcnJlY3RPYnNpZGlhbkZvcm1hdCk7XHJcbiAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGltYWdlRXJyb3IpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIEVycm9yIHByb2Nlc3NpbmcgaW1hZ2UgcmVmZXJlbmNlOmAsIGltYWdlRXJyb3IpO1xyXG4gICAgICAgICAgLy8gQ29udGludWUgd2l0aCBuZXh0IGltYWdlXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIC8vIEZpbmFsbHksIHJlbW92ZSBhbnkgXCJFeHRyYWN0ZWQgSW1hZ2VzXCIgc2VjdGlvbiB0aGF0IG1pZ2h0IGhhdmUgYmVlbiBhZGRlZFxyXG4gICAgICBjb25zdCBleHRyYWN0ZWRJbWFnZXNQYXR0ZXJuID0gL1xcblxcbiMjIEV4dHJhY3RlZCBJbWFnZXNcXG5cXG4oPzohXFxbXFxbW15cXF1dK1xcXVxcXVxcblxcbikqL2c7XHJcbiAgICAgIHVwZGF0ZWRDb250ZW50ID0gdXBkYXRlZENvbnRlbnQucmVwbGFjZShleHRyYWN0ZWRJbWFnZXNQYXR0ZXJuLCAnJyk7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGluIHVwZGF0ZUltYWdlUmVmZXJlbmNlczonLCBlcnJvcik7XHJcbiAgICAgIC8vIFJldHVybiBvcmlnaW5hbCBjb250ZW50IG9uIGVycm9yXHJcbiAgICAgIHJldHVybiBjb250ZW50O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB1cGRhdGVkQ29udGVudDtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNhdmVzIGNvbnZlcnNpb24gcmVzdWx0IHRvIGRpc2sgd2l0aCBjb25zaXN0ZW50IGZpbGUgaGFuZGxpbmdcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIE9wdGlvbnMgZm9yIHNhdmluZyB0aGUgY29udmVyc2lvbiByZXN1bHRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy5jb250ZW50IC0gVGhlIGNvbnRlbnQgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9ucy5tZXRhZGF0YT17fV0gLSBNZXRhZGF0YSB0byBpbmNsdWRlIGluIHRoZSBmcm9udG1hdHRlclxyXG4gICAqIEBwYXJhbSB7QXJyYXl9IFtvcHRpb25zLmltYWdlcz1bXV0gLSBBcnJheSBvZiBpbWFnZSBvYmplY3RzIHRvIHNhdmVcclxuICAgKiBAcGFyYW0ge0FycmF5fSBbb3B0aW9ucy5maWxlcz1bXV0gLSBBcnJheSBvZiBhZGRpdGlvbmFsIGZpbGVzIHRvIHNhdmUgKGZvciBtdWx0aS1maWxlIGNvbnZlcnNpb25zKVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBvcHRpb25zLm5hbWUgLSBCYXNlIG5hbWUgZm9yIHRoZSBvdXRwdXQgZmlsZS9kaXJlY3RvcnlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gb3B0aW9ucy50eXBlIC0gVHlwZSBvZiBjb250ZW50IChlLmcuLCAncGRmJywgJ3VybCcsIGV0Yy4pXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IFtvcHRpb25zLm91dHB1dERpcl0gLSBDdXN0b20gb3V0cHV0IGRpcmVjdG9yeVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9ucy5vcHRpb25zPXt9XSAtIEFkZGl0aW9uYWwgb3B0aW9uc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFJlc3VsdCBvZiB0aGUgc2F2ZSBvcGVyYXRpb25cclxuICAgKi9cclxuICBhc3luYyBzYXZlQ29udmVyc2lvblJlc3VsdCh7IGNvbnRlbnQsIG1ldGFkYXRhID0ge30sIGltYWdlcyA9IFtdLCBmaWxlcyA9IFtdLCBuYW1lLCB0eXBlLCBmaWxlVHlwZSwgb3V0cHV0RGlyLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgY29uc29sZS5sb2coYPCflIQgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTYXZpbmcgY29udmVyc2lvbiByZXN1bHQgZm9yICR7bmFtZX0gKCR7dHlwZSB8fCBmaWxlVHlwZX0pYCk7XHJcbiAgICBcclxuICAgIC8vIFZhbGlkYXRlIHJlcXVpcmVkIHBhcmFtZXRlcnNcclxuICAgIGlmICghY29udGVudCkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBjb250ZW50IHByb3ZpZGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnRlbnQgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24gcmVzdWx0Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghbmFtZSkge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBObyBuYW1lIHByb3ZpZGVkIScpO1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ05hbWUgaXMgcmVxdWlyZWQgZm9yIGNvbnZlcnNpb24gcmVzdWx0Jyk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICghdHlwZSAmJiAhZmlsZVR5cGUpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gdHlwZSBvciBmaWxlVHlwZSBwcm92aWRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdUeXBlIG9yIGZpbGVUeXBlIGlzIHJlcXVpcmVkIGZvciBjb252ZXJzaW9uIHJlc3VsdCcpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVc2UgZmlsZVR5cGUgYXMgZmFsbGJhY2sgZm9yIHR5cGUgaWYgdHlwZSBpcyBub3QgcHJvdmlkZWRcclxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gdHlwZSB8fCBmaWxlVHlwZTtcclxuICAgIFxyXG4gICAgaWYgKCFvdXRwdXREaXIpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gTm8gb3V0cHV0IGRpcmVjdG9yeSBwcm92aWRlZCEnKTtcclxuICAgICAgY29uc29sZS5sb2coJ+KaoO+4jyBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIGRlZmF1bHQgb3V0cHV0IGRpcmVjdG9yeTonLCB0aGlzLmRlZmF1bHRPdXRwdXREaXIpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBVc2UgcHJvdmlkZWQgb3V0cHV0IGRpcmVjdG9yeSBvciBmYWxsIGJhY2sgdG8gZGVmYXVsdFxyXG4gICAgY29uc3QgYmFzZU91dHB1dERpciA9IG91dHB1dERpciB8fCB0aGlzLmRlZmF1bHRPdXRwdXREaXI7XHJcbiAgICBcclxuICAgIC8vIERldGVybWluZSBpZiB3ZSBzaG91bGQgY3JlYXRlIGEgc3ViZGlyZWN0b3J5XHJcbiAgICBjb25zdCB1c2VyUHJvdmlkZWRPdXRwdXREaXIgPSAhIW91dHB1dERpcjtcclxuICAgIGNvbnN0IGNyZWF0ZVN1YmRpcmVjdG9yeSA9IHVzZXJQcm92aWRlZE91dHB1dERpciA/IGZhbHNlIDogXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKG9wdGlvbnMuY3JlYXRlU3ViZGlyZWN0b3J5ICE9PSB1bmRlZmluZWQgPyBvcHRpb25zLmNyZWF0ZVN1YmRpcmVjdG9yeSA6IHRydWUpO1xyXG4gICBcclxuICAgLy8gR2VuZXJhdGUgYXBwcm9wcmlhdGUgZmlsZW5hbWUgYmFzZWQgb24gdHlwZSBhbmQgbWV0YWRhdGFcclxuICAgY29uc3QgZmlsZW5hbWUgPSBnZW5lcmF0ZUFwcHJvcHJpYXRlRmlsZW5hbWUobmFtZSwgY29udGVudFR5cGUsIG1ldGFkYXRhKTtcclxuICAgXHJcbiAgIC8vIERldGVybWluZSBVUkwgc3RhdHVzIGZvciBwYXRoIHZhbGlkYXRpb25cclxuICAgY29uc3QgaXNVcmwgPSBjb250ZW50VHlwZSA9PT0gJ3VybCcgfHwgY29udGVudFR5cGUgPT09ICdwYXJlbnR1cmwnO1xyXG5cclxuICAgIC8vIEdldCB0aGUgYmFzZSBuYW1lIHdpdGhvdXQgZXh0ZW5zaW9uIGFuZCBlbnN1cmUgaXQncyB2YWxpZCBmb3IgdGhlIGZpbGUgc3lzdGVtXHJcbiAgICAvLyBObyBuZWVkIHRvIHJlcGxhY2Ugc3BhY2VzIHdpdGggdW5kZXJzY29yZXMgb3IgbWFrZSBvdGhlciBjaGFuZ2VzIHNpbmNlIGNsZWFuVGVtcG9yYXJ5RmlsZW5hbWUgYWxyZWFkeSBkaWQgdGhhdFxyXG4gICAgY29uc3QgYmFzZU5hbWUgPSBnZXRCYXNlbmFtZShmaWxlbmFtZSk7XHJcbiAgICBjb25zb2xlLmxvZyhg8J+TnSBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIFVzaW5nIGJhc2UgbmFtZTogJHtiYXNlTmFtZX1gKTtcclxuXHJcbiAgICAvLyBGb3Igb3V0cHV0IGRpcmVjdG9yeSBwYXRoLCB1c2UgdGhlIGJhc2UgbmFtZSBidXQgd2l0aG91dCB0aW1lc3RhbXAgc3VmZml4IGluIHRoZSBkaXJlY3RvcnkgbmFtZVxyXG4gICAgLy8gVGhlIHRpbWVzdGFtcCBpcyBvbmx5IGFkZGVkIHRvIHByZXZlbnQgY29sbGlzaW9uc1xyXG4gICAgY29uc3Qgb3V0cHV0QmFzZVBhdGggPSBjcmVhdGVTdWJkaXJlY3RvcnkgP1xyXG4gICAgICBwYXRoLmpvaW4oYmFzZU91dHB1dERpciwgYCR7YmFzZU5hbWV9XyR7RGF0ZS5ub3coKX1gKSA6XHJcbiAgICAgIGJhc2VPdXRwdXREaXI7XHJcblxyXG4gICAgY29uc29sZS5sb2coYPCfk4EgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBHZW5lcmF0ZWQgb3V0cHV0IHBhdGg6ICR7b3V0cHV0QmFzZVBhdGh9YCk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIG91dHB1dCBkaXJlY3Rvcnkgd2l0aCBVUkwgYXdhcmVuZXNzXHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KG91dHB1dEJhc2VQYXRoLCB7IGlzVXJsIH0pO1xyXG4gICAgICBjb25zb2xlLmxvZyhg4pyFIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gQ3JlYXRlZCBvdXRwdXQgZGlyZWN0b3J5OiAke291dHB1dEJhc2VQYXRofWApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gRmFpbGVkIHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGNyZWF0ZSBvdXRwdXQgZGlyZWN0b3J5OiAke2Vycm9yLm1lc3NhZ2V9YCk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ3JlYXRlIGltYWdlcyBkaXJlY3RvcnkgaWYgd2UgaGF2ZSBpbWFnZXNcclxuICAgIGlmIChpbWFnZXMgJiYgaW1hZ2VzLmxlbmd0aCA+IDApIHtcclxuICAgICAgLy8gR3JvdXAgaW1hZ2VzIGJ5IHRoZWlyIGRpcmVjdG9yeSBwYXRoc1xyXG4gICAgICBjb25zdCBpbWFnZXNCeURpciA9IG5ldyBNYXAoKTtcclxuICAgICAgXHJcbiAgICAgIGZvciAoY29uc3QgaW1hZ2Ugb2YgaW1hZ2VzKSB7XHJcbiAgICAgICAgaWYgKCFpbWFnZSB8fCAhaW1hZ2UucGF0aCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBpbWFnZSBvYmplY3Qgb3IgbWlzc2luZyBwYXRoOmAsIGltYWdlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICAvLyBFeHRyYWN0IHRoZSBkaXJlY3RvcnkgcGFydCBmcm9tIHRoZSBpbWFnZSBwYXRoXHJcbiAgICAgICAgY29uc3QgZGlyUGF0aCA9IHBhdGguZGlybmFtZShpbWFnZS5wYXRoKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAoIWltYWdlc0J5RGlyLmhhcyhkaXJQYXRoKSkge1xyXG4gICAgICAgICAgaW1hZ2VzQnlEaXIuc2V0KGRpclBhdGgsIFtdKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgaW1hZ2VzQnlEaXIuZ2V0KGRpclBhdGgpLnB1c2goaW1hZ2UpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICAvLyBDcmVhdGUgZWFjaCB1bmlxdWUgZGlyZWN0b3J5IGFuZCBzYXZlIGl0cyBpbWFnZXNcclxuICAgICAgZm9yIChjb25zdCBbZGlyUGF0aCwgZGlySW1hZ2VzXSBvZiBpbWFnZXNCeURpci5lbnRyaWVzKCkpIHtcclxuICAgICAgICBjb25zdCBmdWxsRGlyUGF0aCA9IHBhdGguam9pbihvdXRwdXRCYXNlUGF0aCwgZGlyUGF0aCk7XHJcbiAgICAgICAgY29uc29sZS5sb2coYPCfk4EgQ3JlYXRpbmcgaW1hZ2VzIGRpcmVjdG9yeTogJHtmdWxsRGlyUGF0aH1gKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0uY3JlYXRlRGlyZWN0b3J5KGZ1bGxEaXJQYXRoLCB7IGlzVXJsIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFNhdmUgaW1hZ2VzIHRvIHRoZWlyIHJlc3BlY3RpdmUgZGlyZWN0b3JpZXNcclxuICAgICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIGRpckltYWdlcykge1xyXG4gICAgICAgICAgaWYgKGltYWdlICYmIGltYWdlLmRhdGEpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICBjb25zdCBpbWFnZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGltYWdlLnBhdGgpO1xyXG4gICAgICAgICAgICAgIGNvbnNvbGUubG9nKGDwn5K+IFNhdmluZyBpbWFnZTogJHtpbWFnZVBhdGh9YCk7XHJcbiAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgLy8gRW5zdXJlIHRoZSBpbWFnZSBkYXRhIGlzIGluIHRoZSByaWdodCBmb3JtYXRcclxuICAgICAgICAgICAgICBjb25zdCBpbWFnZURhdGEgPSBCdWZmZXIuaXNCdWZmZXIoaW1hZ2UuZGF0YSkgXHJcbiAgICAgICAgICAgICAgICA/IGltYWdlLmRhdGEgXHJcbiAgICAgICAgICAgICAgICA6ICh0eXBlb2YgaW1hZ2UuZGF0YSA9PT0gJ3N0cmluZycgJiYgaW1hZ2UuZGF0YS5zdGFydHNXaXRoKCdkYXRhOicpKVxyXG4gICAgICAgICAgICAgICAgICA/IEJ1ZmZlci5mcm9tKGltYWdlLmRhdGEuc3BsaXQoJywnKVsxXSwgJ2Jhc2U2NCcpXHJcbiAgICAgICAgICAgICAgICAgIDogQnVmZmVyLmZyb20oaW1hZ2UuZGF0YSwgJ2Jhc2U2NCcpO1xyXG4gICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLmZpbGVTeXN0ZW0ud3JpdGVGaWxlKGltYWdlUGF0aCwgaW1hZ2VEYXRhLCBudWxsLCB7IGlzVXJsIH0pO1xyXG4gICAgICAgICAgICB9IGNhdGNoIChpbWFnZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBzYXZlIGltYWdlOiAke2ltYWdlLnBhdGh9YCwgaW1hZ2VFcnJvcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihg4pqg77iPIEludmFsaWQgaW1hZ2Ugb2JqZWN0OmAsIGltYWdlKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBEZXRlcm1pbmUgbWFpbiBmaWxlIHBhdGggLSB1c2UgYmFzZU5hbWUgaW5zdGVhZCBvZiBoYXJkY29kZWQgJ2RvY3VtZW50Lm1kJ1xyXG4gICAgLy8gVGhpcyBlbnN1cmVzIHRoZSBvcmlnaW5hbCBmaWxlbmFtZSBpcyBwcmVzZXJ2ZWQgZXZlbiB3aGVuIGNyZWF0aW5nIGEgc3ViZGlyZWN0b3J5XHJcbiAgICBjb25zdCBtYWluRmlsZVBhdGggPSBjcmVhdGVTdWJkaXJlY3RvcnkgP1xyXG4gICAgICBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGAke2Jhc2VOYW1lfS5tZGApIDpcclxuICAgICAgcGF0aC5qb2luKG91dHB1dEJhc2VQYXRoLCBgJHtiYXNlTmFtZX0ubWRgKTtcclxuXHJcbiAgICAvLyBVcGRhdGUgaW1hZ2UgcmVmZXJlbmNlcyB0byB1c2UgT2JzaWRpYW4gZm9ybWF0XHJcbiAgICBjb25zdCB1cGRhdGVkQ29udGVudCA9IHRoaXMudXBkYXRlSW1hZ2VSZWZlcmVuY2VzKGNvbnRlbnQsIGltYWdlcyk7XHJcblxyXG4gICAgLy8gQ3JlYXRlIHN0YW5kYXJkaXplZCBtZXRhZGF0YSB1c2luZyB0aGUgY2VudHJhbGl6ZWQgdXRpbGl0eVxyXG4gICAgY29uc3QgeyBjcmVhdGVTdGFuZGFyZE1ldGFkYXRhIH0gPSByZXF1aXJlKCcuLi9jb252ZXJ0ZXJzL3V0aWxzL21ldGFkYXRhJyk7XHJcbiAgICBjb25zdCBmdWxsTWV0YWRhdGEgPSBjcmVhdGVTdGFuZGFyZE1ldGFkYXRhKHtcclxuICAgICAgdGl0bGU6IG1ldGFkYXRhLnRpdGxlIHx8IGJhc2VOYW1lLFxyXG4gICAgICBmaWxlVHlwZTogY29udGVudFR5cGUsXHJcbiAgICAgIGNvbnZlcnRlZERhdGU6IG5ldyBEYXRlKClcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBBZGQgYW55IGFkZGl0aW9uYWwgbWV0YWRhdGEgZmllbGRzIHRoYXQgYXJlbid0IHBhcnQgb2YgdGhlIHN0YW5kYXJkIHNldFxyXG4gICAgY29uc3QgYWRkaXRpb25hbE1ldGFkYXRhID0geyAuLi5tZXRhZGF0YSB9O1xyXG4gICAgZGVsZXRlIGFkZGl0aW9uYWxNZXRhZGF0YS50aXRsZTtcclxuICAgIGRlbGV0ZSBhZGRpdGlvbmFsTWV0YWRhdGEuZmlsZVR5cGU7XHJcbiAgICBkZWxldGUgYWRkaXRpb25hbE1ldGFkYXRhLmNvbnZlcnRlZDtcclxuICAgIGRlbGV0ZSBhZGRpdGlvbmFsTWV0YWRhdGEudHlwZTtcclxuICAgIGRlbGV0ZSBhZGRpdGlvbmFsTWV0YWRhdGEub3JpZ2luYWxGaWxlTmFtZTsgLy8gRG9uJ3QgaW5jbHVkZSBvcmlnaW5hbEZpbGVOYW1lIGluIGZyb250bWF0dGVyXHJcbiAgICBcclxuICAgIC8vIE1lcmdlIGFkZGl0aW9uYWwgbWV0YWRhdGFcclxuICAgIE9iamVjdC5hc3NpZ24oZnVsbE1ldGFkYXRhLCBhZGRpdGlvbmFsTWV0YWRhdGEpO1xyXG5cclxuICAgIC8vIEV4dHJhY3QgYW5kIG1lcmdlIGZyb250bWF0dGVyIGlmIGl0IGV4aXN0c1xyXG4gICAgY29uc3QgeyBtZXRhZGF0YTogZXhpc3RpbmdNZXRhZGF0YSwgY29udGVudDogY29udGVudFdpdGhvdXRGcm9udG1hdHRlciB9ID0gZXh0cmFjdEZyb250bWF0dGVyKHVwZGF0ZWRDb250ZW50KTtcclxuICAgIGNvbnNvbGUubG9nKCfwn5OdIEV4dHJhY3RlZCBleGlzdGluZyBmcm9udG1hdHRlcjonLCBleGlzdGluZ01ldGFkYXRhKTtcclxuICAgIFxyXG4gICAgLy8gTWVyZ2UgbWV0YWRhdGEgdXNpbmcgc2hhcmVkIHV0aWxpdHlcclxuICAgIGNvbnN0IG1lcmdlZE1ldGFkYXRhID0gbWVyZ2VNZXRhZGF0YShleGlzdGluZ01ldGFkYXRhLCBmdWxsTWV0YWRhdGEsIHtcclxuICAgICAgdHlwZTogZnVsbE1ldGFkYXRhLnR5cGUsIC8vIEVuc3VyZSB0eXBlIGZyb20gZnVsbE1ldGFkYXRhIHRha2VzIHByZWNlZGVuY2VcclxuICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgLy8gQWx3YXlzIHVzZSBjdXJyZW50IHRpbWVzdGFtcFxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIEZvcm1hdCBhbmQgY29tYmluZSB3aXRoIGNvbnRlbnRcclxuICAgIGNvbnN0IGZyb250bWF0dGVyID0gZm9ybWF0TWV0YWRhdGEobWVyZ2VkTWV0YWRhdGEpO1xyXG4gICAgY29uc3QgZnVsbENvbnRlbnQgPSBmcm9udG1hdHRlciArIGNvbnRlbnRXaXRob3V0RnJvbnRtYXR0ZXI7XHJcblxyXG4gICAgLy8gU2F2ZSB0aGUgbWFya2Rvd24gY29udGVudCB3aXRoIFVSTCBhd2FyZW5lc3NcclxuICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUobWFpbkZpbGVQYXRoLCBmdWxsQ29udGVudCwgJ3V0ZjgnLCB7IGlzVXJsIH0pO1xyXG5cclxuICAgIC8vIEhhbmRsZSBhZGRpdGlvbmFsIGZpbGVzIGlmIHByb3ZpZGVkIChmb3IgbXVsdGktZmlsZSBjb252ZXJzaW9ucyBsaWtlIHBhcmVudHVybClcclxuICAgIGlmIChmaWxlcyAmJiBBcnJheS5pc0FycmF5KGZpbGVzKSAmJiBmaWxlcy5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OEIFtDb252ZXJzaW9uUmVzdWx0TWFuYWdlcl0gUHJvY2Vzc2luZyAke2ZpbGVzLmxlbmd0aH0gYWRkaXRpb25hbCBmaWxlc2ApO1xyXG4gICAgICBcclxuICAgICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XHJcbiAgICAgICAgaWYgKCFmaWxlIHx8ICFmaWxlLm5hbWUgfHwgIWZpbGUuY29udGVudCkge1xyXG4gICAgICAgICAgY29uc29sZS53YXJuKGDimqDvuI8gSW52YWxpZCBmaWxlIG9iamVjdDpgLCBmaWxlKTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgLy8gRW5zdXJlIHRoZSBkaXJlY3RvcnkgZXhpc3RzXHJcbiAgICAgICAgICBjb25zdCBmaWxlRGlyUGF0aCA9IHBhdGguZGlybmFtZShwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSkpO1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5maWxlU3lzdGVtLmNyZWF0ZURpcmVjdG9yeShmaWxlRGlyUGF0aCwgeyBpc1VybCB9KTtcclxuICAgICAgICAgIFxyXG4gICAgICAgICAgLy8gU2F2ZSB0aGUgZmlsZVxyXG4gICAgICAgICAgY29uc3QgZmlsZVBhdGggPSBwYXRoLmpvaW4ob3V0cHV0QmFzZVBhdGgsIGZpbGUubmFtZSk7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZyhg8J+SviBTYXZpbmcgYWRkaXRpb25hbCBmaWxlOiAke2ZpbGVQYXRofWApO1xyXG4gICAgICAgICAgXHJcbiAgICAgICAgICAvLyBEZXRlcm1pbmUgaWYgd2UgbmVlZCB0byBhZGQgZnJvbnRtYXR0ZXJcclxuICAgICAgICAgIGxldCBmaWxlQ29udGVudCA9IGZpbGUuY29udGVudDtcclxuICAgICAgICAgIGlmIChmaWxlLnR5cGUgPT09ICd0ZXh0JyAmJiAhZmlsZUNvbnRlbnQudHJpbSgpLnN0YXJ0c1dpdGgoJy0tLScpKSB7XHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSBtZXRhZGF0YSBmb3IgdGhpcyBmaWxlXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVNZXRhZGF0YSA9IGNsZWFuTWV0YWRhdGEoe1xyXG4gICAgICAgICAgICAgIHR5cGU6IGZpbGUudHlwZSB8fCAndGV4dCcsXHJcbiAgICAgICAgICAgICAgY29udmVydGVkOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXHJcbiAgICAgICAgICAgICAgLi4uKGZpbGUubWV0YWRhdGEgfHwge30pXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIGZyb250bWF0dGVyXHJcbiAgICAgICAgICAgIGNvbnN0IGZpbGVGcm9udG1hdHRlciA9IGZvcm1hdE1ldGFkYXRhKGZpbGVNZXRhZGF0YSk7XHJcbiAgICAgICAgICAgIGZpbGVDb250ZW50ID0gZmlsZUZyb250bWF0dGVyICsgZmlsZUNvbnRlbnQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBcclxuICAgICAgICAgIGF3YWl0IHRoaXMuZmlsZVN5c3RlbS53cml0ZUZpbGUoZmlsZVBhdGgsIGZpbGVDb250ZW50LCAndXRmOCcsIHsgaXNVcmwgfSk7XHJcbiAgICAgICAgfSBjYXRjaCAoZmlsZUVycm9yKSB7XHJcbiAgICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHNhdmUgZmlsZTogJHtmaWxlLm5hbWV9YCwgZmlsZUVycm9yKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvLyBMb2cgdGhlIHJlc3VsdCBkZXRhaWxzXHJcbiAgICBjb25zb2xlLmxvZygn8J+SviBDb252ZXJzaW9uIHJlc3VsdCBzYXZlZDonLCB7XHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoLFxyXG4gICAgICBoYXNJbWFnZXM6IGltYWdlcyAmJiBpbWFnZXMubGVuZ3RoID4gMCxcclxuICAgICAgaW1hZ2VDb3VudDogaW1hZ2VzID8gaW1hZ2VzLmxlbmd0aCA6IDAsXHJcbiAgICAgIGFkZGl0aW9uYWxGaWxlczogZmlsZXMgPyBmaWxlcy5sZW5ndGggOiAwLFxyXG4gICAgICBjb250ZW50TGVuZ3RoOiBmdWxsQ29udGVudC5sZW5ndGhcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGVzIChDU1YsIFhMU1gpXHJcbiAgICBjb25zdCBpc0RhdGFGaWxlID0gY29udGVudFR5cGUgPT09ICdjc3YnIHx8IGNvbnRlbnRUeXBlID09PSAneGxzeCcgfHxcclxuICAgICAgICAgICAgICAgICAgICAgIGZpbGVUeXBlID09PSAnY3N2JyB8fCBmaWxlVHlwZSA9PT0gJ3hsc3gnO1xyXG4gICAgaWYgKGlzRGF0YUZpbGUpIHtcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTcGVjaWFsIGhhbmRsaW5nIGZvciBkYXRhIGZpbGU6ICR7dHlwZX1gKTtcclxuICAgICAgXHJcbiAgICAgIC8vIEVuc3VyZSB3ZSBoYXZlIGFsbCByZXF1aXJlZCBwcm9wZXJ0aWVzIGZvciBkYXRhIGZpbGVzXHJcbiAgICAgIGlmICghbWV0YWRhdGEuZm9ybWF0KSB7XHJcbiAgICAgICAgbWV0YWRhdGEuZm9ybWF0ID0gdHlwZTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgaWYgKCFtZXRhZGF0YS50eXBlKSB7XHJcbiAgICAgICAgbWV0YWRhdGEudHlwZSA9ICdzcHJlYWRzaGVldCc7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIEFkZCBhZGRpdGlvbmFsIGxvZ2dpbmcgZm9yIGRhdGEgZmlsZXNcclxuICAgICAgY29uc29sZS5sb2coYPCfk4ogW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBEYXRhIGZpbGUgbWV0YWRhdGE6YCwgbWV0YWRhdGEpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBFbnN1cmUgd2UgaGF2ZSBhIHZhbGlkIG91dHB1dCBwYXRoXHJcbiAgICBpZiAoIW91dHB1dEJhc2VQYXRoKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBbQ29udmVyc2lvblJlc3VsdE1hbmFnZXJdIE5vIG91dHB1dCBwYXRoIGdlbmVyYXRlZCEnKTtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYWlsZWQgdG8gZ2VuZXJhdGUgb3V0cHV0IHBhdGgnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gUmV0dXJuIHN0YW5kYXJkaXplZCByZXN1bHQgd2l0aCBndWFyYW50ZWVkIG91dHB1dFBhdGhcclxuICAgIGNvbnN0IHJlc3VsdCA9IHtcclxuICAgICAgc3VjY2VzczogdHJ1ZSxcclxuICAgICAgb3V0cHV0UGF0aDogb3V0cHV0QmFzZVBhdGgsXHJcbiAgICAgIG1haW5GaWxlOiBtYWluRmlsZVBhdGgsXHJcbiAgICAgIG1ldGFkYXRhOiBmdWxsTWV0YWRhdGFcclxuICAgIH07XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinIUgW0NvbnZlcnNpb25SZXN1bHRNYW5hZ2VyXSBTdWNjZXNzZnVsbHkgc2F2ZWQgY29udmVyc2lvbiByZXN1bHQ6YCwge1xyXG4gICAgICB0eXBlOiBjb250ZW50VHlwZSxcclxuICAgICAgZmlsZVR5cGU6IGZpbGVUeXBlIHx8IHR5cGUsXHJcbiAgICAgIG91dHB1dFBhdGg6IG91dHB1dEJhc2VQYXRoLFxyXG4gICAgICBtYWluRmlsZTogbWFpbkZpbGVQYXRoXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IENvbnZlcnNpb25SZXN1bHRNYW5hZ2VyKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNO0VBQUVDO0FBQUksQ0FBQyxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUUsUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdILE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7QUFDeEUsTUFBTTtFQUFFSSxjQUFjO0VBQUVDLGFBQWE7RUFBRUMsa0JBQWtCO0VBQUVDO0FBQWMsQ0FBQyxHQUFHUCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFDekcsTUFBTTtFQUFFUSxzQkFBc0I7RUFBRUMsV0FBVztFQUFFQztBQUFvQixDQUFDLEdBQUdWLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQzs7QUFFOUY7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLFNBQVNXLDJCQUEyQkEsQ0FBQ0MsWUFBWSxFQUFFQyxJQUFJLEVBQUVDLFFBQVEsR0FBRyxDQUFDLENBQUMsRUFBRTtFQUN0RUMsT0FBTyxDQUFDQyxHQUFHLENBQUMseURBQXlESixZQUFZLEtBQUtDLElBQUksR0FBRyxDQUFDOztFQUU5RjtFQUNBLElBQUlBLElBQUksS0FBSyxLQUFLLElBQUlDLFFBQVEsQ0FBQ0csVUFBVSxFQUFFO0lBQ3pD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