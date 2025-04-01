/**
 * ElectronConversionService.js
 * Handles document conversion using native file system operations in Electron.
 */

const path = require('path');
const { app } = require('electron');
const { convertUrl } = require('../adapters/urlConverterAdapter');
const { convertParentUrl } = require('../adapters/parentUrlConverterAdapter');
const FileSystemService = require('./FileSystemService');
const { textConverterFactory } = require('../adapters/textConverterFactoryAdapter');
const { getFileCategory } = require('../adapters/fileTypeUtilsAdapter');
const { extractMetadata } = require('../adapters/metadataExtractorAdapter');

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

class ElectronConversionService {
  constructor() {
    this.fileSystem = FileSystemService;
    this.converter = textConverterFactory;
    this.progressUpdateInterval = 250; // Update progress every 250ms
    this.defaultOutputDir = path.join(app.getPath('userData'), 'conversions');
    
    console.log('ElectronConversionService initialized with default output directory:', this.defaultOutputDir);
  }

  /**
   * Formats metadata as YAML frontmatter
   * @private
   */
  formatMetadata(metadata) {
    const lines = ['---'];

    // Ensure metadata is an object
    if (!metadata || typeof metadata !== 'object') {
      console.warn('⚠️ Invalid metadata provided to formatMetadata, using empty object');
      metadata = {};
    }

    try {
      // Filter out any image-related metadata
      const cleanedMetadata = Object.fromEntries(
        Object.entries(metadata).filter(([key]) => 
          key && typeof key === 'string' && !key.toLowerCase().includes('image')
        )
      );

      for (const [key, value] of Object.entries(cleanedMetadata)) {
        if (Array.isArray(value)) {
          if (value.length > 0) {
            lines.push(`${key}:`);
            value.forEach(item => {
              if (item !== null && item !== undefined) {
                lines.push(`  - ${item}`);
              }
            });
          }
        } else if (value !== null && value !== undefined && value !== '') {
          try {
            // Safely convert to string and escape special characters
            const valueStr = String(value);
            const needsQuotes = /[:#\[\]{}",\n]/g.test(valueStr);
            const escapedValue = valueStr.replace(/"/g, '\\"');
            lines.push(`${key}: ${needsQuotes ? `"${escapedValue}"` : value}`);
          } catch (error) {
            console.warn(`⚠️ Error formatting metadata value for key "${key}":`, error);
            // Skip this problematic entry
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in formatMetadata:', error);
      // Add a minimal set of metadata to avoid breaking the format
      lines.push(`type: "unknown"`);
      lines.push(`converted: "${new Date().toISOString()}"`);
    }

    lines.push('---\n');
    return lines.join('\n');
  }

  /**
   * Update image references to use Obsidian format
   * @private
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
      // Replace standard markdown image syntax with Obsidian link syntax
      images.forEach(image => {
        // Skip invalid image objects
        if (!image || typeof image !== 'object' || !image.src) {
          console.warn('⚠️ Invalid image object in updateImageReferences:', image);
          return;
        }
        
        try {
          // First replace standard markdown image syntax
          const markdownPattern = new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(image.src)}[^)]*\\)`, 'g');
          updatedContent = updatedContent.replace(markdownPattern, `![[${image.src}]]`);
          
          // Then replace any Obsidian syntax that might use relative paths
          if (image.path && typeof image.path === 'string') {
            const obsidianPattern = new RegExp(`!\\[\\[${escapeRegExp(image.path)}\\]\\]`, 'g');
            updatedContent = updatedContent.replace(obsidianPattern, `![[${image.src}]]`);
          }
          if (image.name && typeof image.name === 'string') {
            const obsidianPattern = new RegExp(`!\\[\\[${escapeRegExp(image.name)}\\]\\]`, 'g');
            updatedContent = updatedContent.replace(obsidianPattern, `![[${image.src}]]`);
          }
        } catch (imageError) {
          console.warn(`⚠️ Error processing image reference for ${image.src}:`, imageError);
          // Continue with next image
        }
      });
    } catch (error) {
      console.error('❌ Error in updateImageReferences:', error);
      // Return original content on error
      return content;
    }

    return updatedContent;
  }

  /**
   * Saves conversion result to disk with consistent file handling
   * @private
   */
  async saveConversionResult({ content, metadata = {}, images = [], name, type, outputDir, options = {} }) {
    // Use provided output directory or fall back to default
    const baseOutputDir = outputDir || this.defaultOutputDir;
    
    // Determine if we should create a subdirectory
    const userProvidedOutputDir = !!outputDir;
    const createSubdirectory = userProvidedOutputDir ? false : 
                             (options.createSubdirectory !== undefined ? options.createSubdirectory : true);
    
    // Generate base name and output path
    const baseName = name.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
    const outputBasePath = createSubdirectory ? 
      path.join(baseOutputDir, `${baseName}_${Date.now()}`) : 
      baseOutputDir;

    // Create output directory
    await this.fileSystem.createDirectory(outputBasePath);

    // Determine main file path
    const mainFilePath = createSubdirectory ? 
      path.join(outputBasePath, 'document.md') : 
      path.join(outputBasePath, `${baseName}.md`);

    // Update image references to use Obsidian format
    const updatedContent = this.updateImageReferences(content, images);

    // Generate YAML frontmatter
    const fullMetadata = {
      type,
      converted: new Date().toISOString(),
      ...metadata
    };

    // Combine frontmatter and content
    const fullContent = this.formatMetadata(fullMetadata) + updatedContent;

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

  /**
   * Converts a file to markdown format
   */
  async convert(filePath, options = {}) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    let lastProgressUpdate = 0;

    try {
      // Validate file exists
      const fileStats = await this.fileSystem.getStats(filePath);
      if (!fileStats.success) {
        throw new Error(`File not found or inaccessible: ${filePath}`);
      }

      // Get file details
      const fileName = path.basename(filePath);
      const fileType = path.extname(fileName).slice(1).toLowerCase();
      const baseName = path.basename(fileName, path.extname(fileName));
      
      // Extract original name if it's a temporary file
      let finalBaseName = baseName;
      if (baseName.startsWith('temp_')) {
        finalBaseName = baseName.replace(/^temp_\d+_/, '');
      }

      const updateProgress = (progress) => {
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= this.progressUpdateInterval) {
          options.onProgress(Math.min(Math.round(progress), 100));
          lastProgressUpdate = now;
        }
      };

      // Determine if this is a video file
      const isVideoFile = ['mp4', 'webm', 'avi'].includes(fileType.toLowerCase());
      
      // Determine if this is likely an academic paper or complex document
      const isLikelyAcademic = /arxiv|paper|journal|conference|proceedings|thesis|dissertation/i.test(fileName);
      
      let conversionResult;
      
      if (isVideoFile) {
        // Use video converter adapter directly for streaming support
        const { convertVideoToMarkdown } = require('../adapters/videoConverterAdapter');
        conversionResult = await convertVideoToMarkdown(filePath, fileName);
      } else {
        // Handle other file types normally
        const isBinaryFile = ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'wav']
          .includes(fileType.toLowerCase());
        
        const fileContent = await this.fileSystem.readFile(filePath, isBinaryFile ? null : undefined);
        
        if (!fileContent.success) {
          throw new Error(`Failed to read file: ${fileContent.error}`);
        }

        updateProgress(20);

        // Add enhanced options for PDF files
        const enhancedOptions = {
          ...options,
          name: fileName,
          onProgress: (progress) => updateProgress(20 + (progress * 0.7))
        };
        
        // Add specific options for PDF files
        if (fileType.toLowerCase() === 'pdf') {
          enhancedOptions.enhancedLayout = options.enhancedLayout !== false; // Enable by default
          enhancedOptions.isAcademic = isLikelyAcademic || options.isAcademic;
        }

        // Convert content
        conversionResult = await this.converter.convertToMarkdown(fileType, fileContent.data, enhancedOptions);
      }

      if (!conversionResult || !conversionResult.content) {
        throw new Error('Conversion produced empty content');
      }

      updateProgress(90);

      // Determine file category with error handling
      let fileCategory;
      try {
        fileCategory = getFileCategory(fileType, fileType);
        // Ensure we have a valid string value
        if (fileCategory === undefined || fileCategory === null) {
          console.warn(`⚠️ getFileCategory returned undefined/null for ${fileType}, defaulting to "text"`);
          fileCategory = 'text';
        }
      } catch (error) {
        console.error(`❌ Error determining file category:`, error);
        fileCategory = 'text'; // Default to text on error
      }

      // Save the conversion result
      const result = await this.saveConversionResult({
        content: conversionResult.content,
        metadata: {
          originalFile: baseName.startsWith('temp_') ? `${finalBaseName}.${fileType}` : fileName,
          type: fileType,
          category: fileCategory,
          ...(conversionResult.pageCount ? { pageCount: conversionResult.pageCount } : {}),
          ...(conversionResult.slideCount ? { slideCount: conversionResult.slideCount } : {}),
          ...(conversionResult.metadata || {}) // Include any metadata from the converter
        },
        images: conversionResult.images || [],
        name: finalBaseName,
        type: fileType,
        outputDir: options.outputDir,
        options
      });

      updateProgress(100);
      return result;

    } catch (error) {
      console.error('❌ Conversion failed:', {
        file: filePath,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Converts a URL to markdown format
   */
  async convertUrl(url, options = {}) {
    const startTime = Date.now();
    let lastProgressUpdate = 0;

    try {
      const updateProgress = (progress) => {
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= this.progressUpdateInterval) {
          options.onProgress(Math.min(Math.round(progress), 100));
          lastProgressUpdate = now;
        }
      };

      updateProgress(10);

      // Convert URL
      const result = await convertUrl(url, {
        ...options,
        includeImages: true,
        includeMeta: true,
        outputDir: options.outputDir || this.defaultOutputDir
      });

      if (!result || !result.content) {
        throw new Error('URL conversion failed: Invalid result from adapter');
      }

      updateProgress(90);
      
      // Generate a name from the URL
      const urlObj = new URL(url);
      const baseName = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname.replace(/\//g, '_') : '');
      
      // Save the conversion result with consolidated metadata
      const savedResult = await this.saveConversionResult({
        content: result.content,
        metadata: {
          ...result.metadata,
          url: url,
          date_scraped: new Date().toISOString(),
          pageCount: 1
        },
        images: result.images || [],
        name: baseName,
        type: 'url',
        outputDir: options.outputDir,
        options
      });

      updateProgress(100);
      return savedResult;

    } catch (error) {
      console.error('❌ URL conversion failed:', {
        url,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Converts a parent URL and its child pages to markdown format
   */
  async convertParentUrl(url, options = {}) {
    const startTime = Date.now();
    let lastProgressUpdate = 0;

    try {
      const updateProgress = (progress) => {
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= this.progressUpdateInterval) {
          options.onProgress(Math.min(Math.round(progress), 100));
          lastProgressUpdate = now;
        }
      };

      updateProgress(10);

      const result = await convertParentUrl(url, {
        ...options,
        includeImages: true,
        includeMeta: true,
        outputDir: options.outputDir || this.defaultOutputDir
      });

      if (!result || !result.content) {
        throw new Error('Parent URL conversion failed: Invalid result from adapter');
      }

      updateProgress(50);

      // Generate a name from the URL
      const urlObj = new URL(url);
      const baseName = `${urlObj.hostname}_site`;
      
      // Create output directory
      const baseOutputDir = options.outputDir || this.defaultOutputDir;
      const userProvidedOutputDir = !!options.outputDir;
      const createSubdirectory = userProvidedOutputDir ? false : 
                               (options.createSubdirectory !== undefined ? options.createSubdirectory : true);
      
      const outputBasePath = createSubdirectory ? 
        path.join(baseOutputDir, `${baseName}_${Date.now()}`) : 
        baseOutputDir;
      
      await this.fileSystem.createDirectory(outputBasePath);
      
      // Save the main index file with frontmatter
      const mainFilePath = createSubdirectory ? 
        path.join(outputBasePath, 'index.md') : 
        path.join(outputBasePath, `${baseName}.md`);
      
      // Generate YAML frontmatter
      const fullMetadata = {
        type: 'parent',
        converted: new Date().toISOString(),
        ...result.metadata,
        url: url,
        date_scraped: new Date().toISOString(),
        pageCount: result.stats?.totalPages || 1
      };
      
      // Combine frontmatter and content
      const fullContent = this.formatMetadata(fullMetadata) + result.content;
      
      // Save the main index file
      await this.fileSystem.writeFile(mainFilePath, fullContent);
      
      updateProgress(70);
      
      // Save all child page files
      if (result.files && result.files.length > 0) {
        // Skip the first file which is the index
        const childFiles = result.files.filter(f => f.name !== 'index.md');
        
        for (let i = 0; i < childFiles.length; i++) {
          const file = childFiles[i];
          const filePath = path.join(outputBasePath, file.name);
          
          // Create directory for the file if needed
          await this.fileSystem.createDirectory(path.dirname(filePath));
          
          // Save the file
          await this.fileSystem.writeFile(filePath, file.content);
          
          // Update progress
          updateProgress(70 + (i / childFiles.length) * 30);
        }
      }

      updateProgress(100);
      
      return {
        success: true,
        outputPath: outputBasePath,
        mainFile: mainFilePath,
        metadata: fullMetadata,
        stats: result.stats
      };

    } catch (error) {
      console.error('❌ Parent URL conversion failed:', {
        url,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Converts a YouTube URL to markdown format (temporarily disabled)
   */
  async convertYoutube(url, options = {}) {
    return {
      success: false,
      error: 'YouTube conversion temporarily disabled'
    };
  }

  /**
   * Converts multiple files, URLs, and parent URLs in batch
   */
  async convertBatch(items, options = {}) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    const results = [];
    const CHUNK_SIZE = 5;

    try {
      const outputDir = options.outputDir || this.defaultOutputDir;
      const batchName = options.batchName || `Batch_${new Date().toISOString().replace(/:/g, '-')}`;
      const batchOutputPath = path.join(outputDir, batchName);
      
      await this.fileSystem.createDirectory(batchOutputPath);

      // Process in chunks
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        
        const chunkResults = await Promise.all(
          chunk.map(async (item) => {
            try {
              let result;
              
              switch(item.type) {
                case 'url':
                  result = await this.convertUrl(item.url, {
                    ...options,
                    ...item.options,
                    onProgress: (progress) => {
                      if (options.onProgress) {
                        options.onProgress({
                          id: item.id,
                          type: 'url',
                          url: item.url,
                          progress
                        });
                      }
                    }
                  });
                  break;

                case 'parent':
                  result = await this.convertParentUrl(item.url, {
                    ...options,
                    ...item.options,
                    onProgress: (progress) => {
                      if (options.onProgress) {
                        options.onProgress({
                          id: item.id,
                          type: 'parent',
                          url: item.url,
                          progress
                        });
                      }
                    }
                  });
                  break;

                case 'file':
                  result = await this.convert(item.path, {
                    ...options,
                    ...item.options,
                    onProgress: (progress) => {
                      if (options.onProgress) {
                        options.onProgress({
                          id: item.id,
                          type: 'file',
                          file: path.basename(item.path),
                          progress,
                          isTemporary: item.isTemporary
                        });
                      }
                    }
                  });
                  break;

                default:
                  throw new Error(`Unsupported item type: ${item.type}`);
              }

              result.itemId = item.id;
              result.itemType = item.type;
              result.originalItem = item;

              return result;
            } catch (error) {
              return {
                success: false,
                itemId: item.id,
                itemType: item.type,
                error: error.message,
                originalItem: item
              };
            }
          })
        );

        results.push(...chunkResults);

        if (global.gc && process.memoryUsage().heapUsed > 512 * 1024 * 1024) {
          global.gc();
        }
      }
      
      // Create summary
      const summaryContent = [
        '# Batch Conversion Summary',
        '',
        `- **Date:** ${new Date().toISOString()}`,
        `- **Total Items:** ${results.length}`,
        `- **Successfully Converted:** ${results.filter(r => r.success).length}`,
        `- **Failed:** ${results.filter(r => !r.success).length}`,
        `- **Duration:** ${Math.round((Date.now() - startTime)/1000)} seconds`,
        '',
        '## Items',
        '',
        ...results.map((result) => {
          const item = result.originalItem;
          const status = result.success ? '✅ Success' : `❌ Failed: ${result.error || 'Unknown error'}`;
          let itemDescription;
          
          switch(item.type) {
            case 'url':
              itemDescription = `URL: ${item.url}`;
              break;
            case 'parent':
              itemDescription = `Website: ${item.url}`;
              break;
            case 'file':
              itemDescription = `File: ${item.isTemporary ? '(temp) ' : ''}${path.basename(item.path)}`;
              break;
            default:
              itemDescription = `Unknown type: ${item.type}`;
          }
          
          return `- **${itemDescription}**: ${status}`;
        })
      ].join('\n');
      
      await this.fileSystem.writeFile(
        path.join(batchOutputPath, 'batch-summary.md'),
        summaryContent
      );

      return {
        success: true,
        outputPath: batchOutputPath,
        results,
        stats: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
          duration: Date.now() - startTime
        }
      };

    } catch (error) {
      console.error('❌ Batch conversion failed:', error);
      return {
        success: false,
        error: error.message,
        results
      };
    }
  }

  /**
   * Sets up the output directory for conversions
   */
  async setupOutputDirectory(outputDir) {
    try {
      const dirToSetup = outputDir || this.defaultOutputDir;
      await this.fileSystem.createDirectory(dirToSetup);
      console.log('📁 Output directory ready:', dirToSetup);
    } catch (error) {
      console.error('❌ Failed to set up output directory:', error);
      throw error;
    }
  }
}

module.exports = new ElectronConversionService();
