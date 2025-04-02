/**
 * ElectronConversionService.js
 * Handles document conversion using native file system operations in Electron.
 * Coordinates conversion processes and delegates to backend services via adapters.
 * 
 * This service has been refactored to better leverage existing backend functionality
 * while maintaining the same interface for Electron-specific concerns.
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
const WorkerManager = require('./WorkerManager');

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
      // Create a progress tracker
      const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
      progressTracker.update(10);
      
      // Prepare data for backend conversion service
      const conversionData = {
        type: 'parenturl',
        content: url,
        name: new URL(url).hostname,
        options: {
          ...options,
          includeImages: true,
          includeMeta: true,
          outputDir: options.outputDir || this.defaultOutputDir,
          onProgress: (progress) => progressTracker.updateScaled(progress, 10, 50)
        }
      };
      
      // Use the backend conversion service via adapter
      const result = await conversionServiceAdapter.convert(conversionData);
      
      progressTracker.update(50);
      
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
      
      progressTracker.update(100);
      
      console.log(`✅ Parent URL conversion completed in ${Date.now() - startTime}ms:`, {
        url,
        outputPath: outputBasePath,
        childPages: result.files?.length || 0
      });
      
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
   */
  async convertBatch(items, options = {}) {
    const startTime = Date.now();
    const progressTracker = new ProgressTracker(options.onProgress, this.progressUpdateInterval);
    progressTracker.update(5);
    
    try {
      // Set up output directory
      const outputDir = options.outputDir || this.defaultOutputDir;
      const batchName = options.batchName || `Batch_${new Date().toISOString().replace(/:/g, '-')}`;
      const batchOutputPath = path.join(outputDir, batchName);
      
      await this.fileSystem.createDirectory(batchOutputPath);
      progressTracker.update(10);
      
      // Prepare items for conversion
      const preparedItems = await this._prepareBatchItems(items, {
        ...options,
        outputDir: batchOutputPath
      });
      
      progressTracker.update(20);
      
      // Filter out items that failed preparation
      const validItems = preparedItems.filter(item => !item.error);
      const failedItems = preparedItems.filter(item => item.error);
      
      console.log(`🔄 Batch conversion: ${validItems.length} valid items, ${failedItems.length} failed preparation`);
      
      // Process batch using worker manager
      let batchResult;
      if (validItems.length > 0) {
        try {
          // Create worker manager with maximum 4 workers
          const workerManager = new WorkerManager({
            maxWorkers: 4
          });
          
          // Add progress tracking to options
          const workerOptions = {
            ...options,
            onProgress: (progress) => {
              // Update overall progress
              progressTracker.updateScaled(progress.progress || 0, 20, 90);
              
              // Forward individual file progress if callback exists
              if (options.onProgress && progress.id) {
                options.onProgress({
                  id: progress.id,
                  file: progress.file,
                  progress: progress.progress || 0
                });
              }
            }
          };
          
          // Process batch using worker manager
          batchResult = await workerManager.processBatch(validItems, workerOptions);
          
          // Process the results and write files to the batch output directory
          if (batchResult.results && batchResult.results.length > 0) {
            await this._writeBatchResults(batchResult.results, batchOutputPath);
          }
        } catch (error) {
          console.error(`❌ Worker-based batch conversion error:`, error);
          
          // Fallback to adapter-based conversion as a last resort
          console.log(`⚠️ Falling back to adapter-based batch conversion`);
          
          try {
            batchResult = await conversionServiceAdapter.convertBatch(validItems);
            
            // Process the results
            if (batchResult.results && batchResult.results.length > 0) {
              await this._writeBatchResults(batchResult.results, batchOutputPath);
            }
          } catch (fallbackError) {
            console.error(`❌ Fallback batch conversion also failed:`, fallbackError);
            batchResult = {
              success: false,
              error: `Worker-based conversion failed: ${error.message}. Fallback also failed: ${fallbackError.message}`,
              results: []
            };
          }
        }
      } else {
        batchResult = {
          success: true,
          results: []
        };
      }
      
      progressTracker.update(90);
      
      // Combine results with failed preparation items
      const results = this._combineBatchResults(batchResult, failedItems, items);
      
      progressTracker.update(100);
      
      console.log(`✅ Batch conversion completed in ${Date.now() - startTime}ms:`, {
        totalItems: results.length,
        successfulItems: results.filter(r => r.success).length,
        failedItems: results.filter(r => !r.success).length,
        outputPath: batchOutputPath
      });
      
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
      console.error('❌ Batch conversion failed:', {
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        results: []
      };
    }
  }
  
  /**
   * Prepare items for batch conversion
   * @param {Array<Object>} items - Array of items to prepare
   * @param {Object} options - Preparation options
   * @returns {Promise<Array<Object>>} - Array of prepared items
   * @private
   */
  async _prepareBatchItems(items, options = {}) {
    return await Promise.all(items.map(async (item) => {
      try {
        switch(item.type) {
          case 'url':
          case 'parent':
            return {
              id: item.id || uuidv4(),
              type: item.type === 'parent' ? 'parenturl' : 'url',
              content: item.url,
              name: new URL(item.url).hostname,
              options: {
                ...options,
                ...item.options,
                includeImages: true,
                includeMeta: true
              }
            };
            
          case 'file':
            // Validate file exists
            const fileStats = await this.fileSystem.getStats(item.path);
            if (!fileStats.success) {
              throw new Error(`File not found or inaccessible: ${item.path}`);
            }
            
            // Get file details
            const fileName = path.basename(item.path);
            const fileType = path.extname(fileName).slice(1).toLowerCase();
            
            // Read file content
            const isBinaryFile = ['pdf', 'docx', 'pptx', 'xlsx', 'jpg', 'jpeg', 'png', 'gif', 'mp3', 'wav']
              .includes(fileType.toLowerCase());
            
            const fileContent = await this.fileSystem.readFile(item.path, isBinaryFile ? null : undefined);
            
            if (!fileContent.success) {
              throw new Error(`Failed to read file: ${fileContent.error}`);
            }
            
            return {
              id: item.id || uuidv4(),
              type: fileType,
              content: fileContent.data,
              name: fileName,
              options: {
                ...options,
                ...item.options
              }
            };
            
          default:
            throw new Error(`Unsupported item type: ${item.type}`);
        }
      } catch (error) {
        console.error(`❌ Failed to prepare item for batch conversion:`, {
          item,
          error: error.message
        });
        
        return {
          id: item.id || uuidv4(),
          error: error.message,
          originalItem: item
        };
      }
    }));
  }
  
  /**
   * Write batch results to output directory
   * @param {Array<Object>} results - Array of conversion results
   * @param {string} batchOutputPath - Path to batch output directory
   * @returns {Promise<void>}
   * @private
   */
  async _writeBatchResults(results, batchOutputPath) {
    console.log(`📁 Writing ${results.length} files to batch output directory`);
    
    for (const result of results) {
      try {
        if (!result || !result.content) continue;
        
        const category = result.category || 'unknown';
        const categoryDir = path.join(batchOutputPath, category);
        
        // Create category directory if it doesn't exist
        await this.fileSystem.createDirectory(categoryDir);
        
        // Generate filename - clean any temporary filename patterns
        const cleanedName = cleanTemporaryFilename(result.name);
        const baseName = path.basename(cleanedName, path.extname(cleanedName));
        const outputFile = path.join(categoryDir, `${baseName}.md`);
        
        // Write the file
        await this.fileSystem.writeFile(outputFile, result.content);
        console.log(`✅ Wrote file: ${outputFile}`);
      } catch (fileError) {
        console.error(`❌ Error writing result file:`, {
          name: result.name,
          error: fileError.message
        });
      }
    }
  }
  
  /**
   * Combine batch results with failed preparation items
   * @param {Object} batchResult - Batch conversion result
   * @param {Array<Object>} failedItems - Array of items that failed preparation
   * @param {Array<Object>} originalItems - Original items array
   * @returns {Array<Object>} - Combined results array
   * @private
   */
  _combineBatchResults(batchResult, failedItems, originalItems) {
    return [
      ...(batchResult.results || []).map(result => ({
        ...result,
        itemId: result.id,
        itemType: result.type,
        originalItem: originalItems.find(item => item.id === result.id)
      })),
      ...failedItems.map(item => ({
        success: false,
        itemId: item.id,
        itemType: item.originalItem?.type,
        error: item.error,
        originalItem: item.originalItem
      }))
    ];
  }
  
  /**
   * Create and save batch summary
   * @param {Array<Object>} results - Array of conversion results
   * @param {string} batchOutputPath - Path to batch output directory
   * @param {number} startTime - Batch start time
   * @returns {Promise<Object>} - Summary result
   * @private
   */
  async _createBatchSummary(results, batchOutputPath, startTime) {
    // Create summary content
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
        
        switch(item?.type) {
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
            itemDescription = `Unknown type: ${item?.type || 'unknown'}`;
        }
        
        return `- **${itemDescription}**: ${status}`;
      })
    ].join('\n');
    
    // Save the summary using ConversionResultManager
    return await this.resultManager.saveConversionResult({
      content: summaryContent,
      metadata: {
        type: 'batch-summary',
        converted: new Date().toISOString(),
        totalItems: results.length,
        successfulItems: results.filter(r => r.success).length,
        failedItems: results.filter(r => !r.success).length,
        duration: Date.now() - startTime
      },
      images: [],
      name: 'batch-summary',
      type: 'markdown',
      outputDir: batchOutputPath,
      options: {
        createSubdirectory: false // Don't create another subdirectory
      }
    });
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
