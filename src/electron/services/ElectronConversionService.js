/**
 * ElectronConversionService.js
 * Handles document conversion using native file system operations in Electron.
 * Coordinates conversion processes and delegates to backend services via adapters.
 * 
 * This service has been refactored to better leverage existing backend functionality
 * while maintaining the same interface for Electron-specific concerns.
 * 
 * TEMPORARILY MODIFIED: Batch processing functionality has been disabled to simplify
 * the application to only handle one item at a time.
 * 
 * Related files:
 * - src/electron/services/ConversionResultManager.js: Handles saving conversion results
 * - src/electron/services/FileSystemService.js: Handles file system operations
 * - src/electron/utils/progressTracker.js: Handles progress tracking
 * - src/electron/adapters/conversionServiceAdapter.js: Adapter for backend ConversionService
 * - backend/src/services/ConversionService.js: Backend conversion implementation
 */

const path = require('path');
const { app } = require('electron');
const { v4: uuidv4 } = require('uuid');
const FileSystemService = require('./FileSystemService');
const ConversionResultManager = require('./ConversionResultManager');
const { textConverterFactory } = require('../adapters/textConverterFactoryAdapter');
const { getFileCategory } = require('../adapters/fileTypeUtilsAdapter');
const ProgressTracker = require('../utils/progressTracker');
const conversionServiceAdapter = require('../adapters/conversionServiceAdapter');

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

class ElectronConversionService {
  constructor() {
    this.fileSystem = FileSystemService;
    this.resultManager = ConversionResultManager;
    this.converter = textConverterFactory;
    this.progressUpdateInterval = 250; // Update progress every 250ms
    this.defaultOutputDir = path.join(app.getPath('userData'), 'conversions');
    
    console.log('ElectronConversionService initialized with default output directory:', this.defaultOutputDir);
  }

  /**
   * Converts a file to markdown format
   */
  async convert(filePath, options = {}) {
    const startTime = Date.now();
    
    try {
      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      progressTracker.update(5);
      
      // Validate file exists
      const fileStats = await this.fileSystem.getStats(filePath);
      if (!fileStats.success) {
        throw new Error(`File not found or inaccessible: ${filePath}`);
      }
      
      // Get file details
      const fileName = path.basename(filePath);
      const fileType = path.extname(fileName).slice(1).toLowerCase();
      const baseName = path.basename(fileName, path.extname(fileName));
      
      // Clean the filename if it's a temporary file
      const cleanedFileName = cleanTemporaryFilename(fileName);
      const finalBaseName = path.basename(cleanedFileName, path.extname(cleanedFileName));
      
      progressTracker.update(10);
      
      // Determine if this is a video file
      const isVideoFile = ['mp4', 'webm', 'avi'].includes(fileType.toLowerCase());
      
      let conversionResult;
      
      if (isVideoFile) {
        // Use video converter adapter directly for streaming support
        const { convertVideoToMarkdown } = require('../adapters/videoConverterAdapter');
        
        // Pass the progress tracker to the video converter
        conversionResult = await convertVideoToMarkdown(filePath, fileName, {
          onProgress: (progress) => progressTracker.update(progress)
        });
      } else {
        // Handle other file types normally
        const isBinaryFile = ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'wav']
          .includes(fileType.toLowerCase());
        
        const fileContent = await this.fileSystem.readFile(filePath, isBinaryFile ? null : undefined);
        
        if (!fileContent.success) {
          throw new Error(`Failed to read file: ${fileContent.error}`);
        }
        
        progressTracker.update(20);
        
        // Prepare data for backend conversion service
        const conversionData = {
          type: fileType,
          content: fileContent.data,
          name: fileName,
          apiKey: options.apiKey,
          options: {
            ...options,
            onProgress: (progress) => progressTracker.updateScaled(progress, 20, 90)
          }
        };
        
        // Use the backend conversion service via adapter
        conversionResult = await conversionServiceAdapter.convert(conversionData);
      }
      
      progressTracker.update(90);
      
      // Extract content from result
      const content = conversionResult.content || (conversionResult.buffer ? conversionResult.buffer.toString() : '');
      
      if (!content) {
        throw new Error('Conversion produced empty content');
      }
      
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
      
      // Save the conversion result using the ConversionResultManager
      const result = await this.resultManager.saveConversionResult({
        content: content,
        metadata: {
          originalFile: cleanedFileName,
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
      
      progressTracker.update(100);
      
      console.log(`✅ File conversion completed in ${Date.now() - startTime}ms:`, {
        file: filePath,
        outputPath: result.outputPath
      });
      
      return result;
      
    } catch (error) {
      console.error('❌ Conversion failed:', {
        file: filePath,
        error: error.message,
        stack: error.stack
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
    
    try {
      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      progressTracker.update(10);
      
      // Prepare data for backend conversion service
      const conversionData = {
        type: 'url',
        content: url,
        name: new URL(url).hostname,
        options: {
          ...options,
          includeImages: true,
          includeMeta: true,
          outputDir: options.outputDir || this.defaultOutputDir,
          onProgress: (progress) => progressTracker.updateScaled(progress, 10, 90)
        }
      };
      
      // Use the backend conversion service via adapter
      const result = await conversionServiceAdapter.convert(conversionData);
      
      progressTracker.update(90);
      
      // Generate a name from the URL
      const urlObj = new URL(url);
      const baseName = urlObj.hostname + (urlObj.pathname !== '/' ? urlObj.pathname.replace(/\//g, '_') : '');
      
      // Extract content from result
      const content = result.content || (result.buffer ? result.buffer.toString() : '');
      
      if (!content) {
        throw new Error('URL conversion failed: Empty content returned');
      }
      
      // Save the conversion result with consolidated metadata
      const savedResult = await this.resultManager.saveConversionResult({
        content: content,
        metadata: {
          ...(result.metadata || {}),
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
      
      progressTracker.update(100);
      
      console.log(`✅ URL conversion completed in ${Date.now() - startTime}ms:`, {
        url,
        outputPath: savedResult.outputPath
      });
      
      return savedResult;
    } catch (error) {
      console.error('❌ URL conversion failed:', {
        url,
        error: error.message,
        stack: error.stack
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
    
    try {
      // Create a progress tracker with website-specific status updates
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      
      // Initialize website conversion status with clear starting state
      if (options.onProgress) {
        // First set the initial status
        options.onProgress({
          status: 'initializing',
          websiteUrl: url,
          startTime: Date.now()
        });
      }
      
      progressTracker.update(5);
      
      // Extract path filter from URL if it contains a specific path
      // For example, if URL is "example.com/blogs", set pathFilter to "/blogs"
      let pathFilter = null;
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
        if (urlObj.pathname && urlObj.pathname !== '/') {
          pathFilter = urlObj.pathname;
          console.log(`Detected path filter from URL: ${pathFilter}`);
          
          // Update status with path filter but maintain current status
          if (options.onProgress) {
            options.onProgress({
              pathFilter: pathFilter
            });
          }
        }
      } catch (error) {
        console.warn('Failed to extract path filter from URL:', error.message);
      }
      
      // Update status to finding sitemap - this is the first real step in website conversion
      if (options.onProgress) {
        console.log('ElectronConversionService: Setting status to finding_sitemap');
        options.onProgress({
          status: 'finding_sitemap',
          websiteUrl: url,
          pathFilter: pathFilter
        });
      }
      
      // Prepare data for backend conversion service
      const conversionData = {
        type: 'parenturl',
        content: url,
        name: new URL(url).hostname,
        options: {
          ...options,
          includeImages: true,
          includeMeta: true,
          pathFilter: pathFilter || options.pathFilter, // Use detected path filter or provided one
          outputDir: options.outputDir || this.defaultOutputDir,
          onProgress: (progressData) => {
            // Always pass through all backend information
            if (options.onProgress && typeof progressData === 'object') {
              // Clean and standardize the progress data
              const cleanedData = {
                ...progressData,
                // Ensure required fields are present
                status: progressData.status || 'converting',
                websiteUrl: url,
                // Keep the original progress value
                progress: progressData.progress,
                // Preserve all page processing information
                currentUrl: progressData.currentUrl,
                currentPath: progressData.currentPath,
                currentHost: progressData.currentHost,
                processedCount: progressData.processedCount,
                totalCount: progressData.totalCount,
                // Ensure section information is preserved
                sections: progressData.sections,
                currentSection: progressData.section || progressData.currentSection
              };

              // Log progress update for debugging
              console.log('[ElectronConversionService] Website progress update:', {
                data: cleanedData,
                timestamp: new Date().toISOString()
              });

              // Pass through to the progress handler
              options.onProgress(cleanedData);
            }

            // Update overall progress if a number is provided
            if (typeof progressData === 'number') {
              progressTracker.update(progressData);
            } else if (progressData.progress) {
              progressTracker.update(progressData.progress);
            }
          }
        }
      };
      
      // Use the backend conversion service via adapter
      if (options.onProgress) {
        options.onProgress({
          status: 'converting',
          currentFile: url
        });
      }
      
      const result = await conversionServiceAdapter.convert(conversionData);
      
      progressTracker.update(50);
      
      // Update status to generating index - don't mark as completed yet
      if (options.onProgress) {
        options.onProgress({
          status: 'generating_index',
          processedCount: result.stats?.successfulPages || 0,
          totalCount: result.stats?.totalPages || 0,
          progress: 90 // Almost done but not complete
        });
      }
      
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
      
      // Extract content from result
      const content = result.content || (result.buffer ? result.buffer.toString() : '');
      
      if (!content) {
        throw new Error('Parent URL conversion failed: Empty content returned');
      }
      
      // Generate YAML frontmatter
      const fullMetadata = {
        type: 'parent',
        converted: new Date().toISOString(),
        ...(result.metadata || {}),
        url: url,
        date_scraped: new Date().toISOString(),
        pageCount: result.stats?.totalPages || 1
      };
      
      // Save the main index file using ConversionResultManager
      const savedResult = await this.resultManager.saveConversionResult({
        content: content,
        metadata: fullMetadata,
        images: result.images || [],
        name: baseName,
        type: 'parent',
        outputDir: outputBasePath,
        options: {
          createSubdirectory: false // Already created the directory
        }
      });
      
      progressTracker.update(70);
      
      // Save all child page files if they exist
      if (result.files && result.files.length > 0) {
        // Skip the first file which is the index
        const childFiles = result.files.filter(f => f.name !== 'index.md');
        
        for (let i = 0; i < childFiles.length; i++) {
          const file = childFiles[i];
          const childBaseName = path.basename(file.name, '.md');
          const childDirPath = path.dirname(file.name);
          
          // Create directory for the file if needed
          if (childDirPath !== '.') {
            await this.fileSystem.createDirectory(path.join(outputBasePath, childDirPath));
          }
          
          // Save the file using ConversionResultManager for consistent formatting
          await this.resultManager.saveConversionResult({
            content: file.content,
            metadata: {
              type: 'child-page',
              parent: url,
              converted: new Date().toISOString()
            },
            images: [], // Child page images should already be in the parent's images
            name: childBaseName,
            type: 'markdown',
            outputDir: path.join(outputBasePath, childDirPath),
            options: {
              createSubdirectory: false // Don't create another subdirectory
            }
          });
          
          // Update progress
          progressTracker.updateScaled(i, 70, 100, childFiles.length);
        }
      }
      
      // Update progress to almost complete, but not 100% yet
      progressTracker.update(95);
      
      console.log(`✅ Parent URL conversion completed in ${Date.now() - startTime}ms:`, {
        url,
        outputPath: outputBasePath,
        childPages: result.files?.length || 0
      });
      
      // Final progress update - NOW we can mark as 100% complete
      // This happens right before returning, when all work is truly done
      progressTracker.update(100);
      
      // Add a small delay to ensure UI has time to process the completion
      await new Promise(resolve => setTimeout(resolve, 200));
      
      return {
        success: true,
        outputPath: outputBasePath,
        mainFile: savedResult.mainFile,
        metadata: fullMetadata,
        stats: result.stats
      };
      
    } catch (error) {
      console.error('❌ Parent URL conversion failed:', {
        url,
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Converts multiple files, URLs, and parent URLs in batch using worker processes
   * @param {Array<Object>} items - Array of items to convert
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Batch conversion result
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  async convertBatch(items, options = {}) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    console.warn('Batch conversion is temporarily disabled');
    
    // Only process the first item if multiple are provided
    if (items && items.length > 0) {
      const item = items[0];
      
      try {
        console.log(`Converting single item instead of batch:`, {
          type: item.type,
          path: item.path,
          url: item.url
        });
        
        // Process based on item type
        if (item.path) {
          return await this.convert(item.path, options);
        } else if (item.url) {
          if (item.type === 'parenturl') {
            return await this.convertParentUrl(item.url, options);
          } else {
            return await this.convertUrl(item.url, options);
          }
        } else {
          throw new Error('Item has neither path nor URL');
        }
      } catch (error) {
        console.error('Single item conversion failed:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
    
    return {
      success: false,
      error: 'No items provided for conversion'
    };
  }
  
  /**
   * Prepare items for batch conversion
   * @param {Array<Object>} items - Array of items to prepare
   * @param {Object} options - Preparation options
   * @returns {Promise<Array<Object>>} - Array of prepared items
   * @private
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  async _prepareBatchItems(items, options = {}) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    console.warn('Batch item preparation is temporarily disabled');
    
    // Only process the first item if multiple are provided
    if (items && items.length > 0) {
      return [items[0]];
    }
    
    return [];
  }
  
  /**
   * Write batch results to output directory
   * @param {Array<Object>} results - Array of conversion results
   * @param {string} batchOutputPath - Path to batch output directory
   * @returns {Promise<void>}
   * @private
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  async _writeBatchResults(results, batchOutputPath) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    console.warn('Batch result writing is temporarily disabled');
    return;
  }
  
  /**
   * Write only the content file (no images)
   * @param {Object} result - Conversion result
   * @param {string} baseName - Base name for the file
   * @param {string} outputPath - Output directory path
   * @returns {Promise<string>} - Path to the written file
   * @private
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  async _writeContentFileOnly(result, baseName, outputPath) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    console.warn('Content file writing is temporarily disabled');
    return '';
  }
  
  /**
   * Combine batch results with failed preparation items
   * @param {Object} batchResult - Batch conversion result
   * @param {Array<Object>} failedItems - Array of items that failed preparation
   * @param {Array<Object>} originalItems - Original items array
   * @returns {Array<Object>} - Combined results array
   * @private
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  _combineBatchResults(batchResult, failedItems, originalItems) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    return [];
  }
  
  /**
   * Create and save batch summary
   * @param {Array<Object>} results - Array of conversion results
   * @param {string} batchOutputPath - Path to batch output directory
   * @param {number} startTime - Batch start time
   * @returns {Promise<Object>} - Summary result
   * @private
   * 
   * TEMPORARILY DISABLED: Batch processing functionality has been disabled
   */
  async _createBatchSummary(results, batchOutputPath, startTime) {
    // TEMPORARILY DISABLED: Batch processing functionality has been disabled
    console.warn('Batch summary creation is temporarily disabled');
    return { success: false };
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
