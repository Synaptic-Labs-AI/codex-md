// routes/utils/zipProcessor.js

import JSZip from 'jszip';
import sanitizeFilename from 'sanitize-filename';
import path from 'path';
import { determineCategory } from '../../../utils/fileTypeUtils.js';
import { textConverterFactory } from '../../../services/converter/textConverterFactory.js';  // Fix path with correct number of directory levels

/**
 * Escapes RegExp special characters in a string.
 * @param {string} string - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Handles the conversion of a single item.
 * @param {string} type - The type of content (e.g., 'file', 'url', etc.)
 * @param {string|Buffer|Object} content - The content to convert
 * @param {string} name - The name of the item
 * @param {string} apiKey - The API key for authenticated services
 * @returns {Promise<Object>} - The result of the conversion
 */
export async function handleConversion(type, content, name, apiKey) {
  try {
    const conversionResult = await textConverterFactory.convertToMarkdown(
      type,
      content,
      name,
      apiKey
    );

    if (!conversionResult.content) {
      throw new Error('Conversion produced no content');
    }

    const fileType = path.extname(name).substring(1).toLowerCase();
    // Use category from content or determine it using the utility
    const category = content.category || determineCategory(type, fileType);

    return {
      success: true,
      content: conversionResult.content,
      type,
      name: sanitizeFilename(name),
      category,
      images: conversionResult.images || [],
      originalContent: content // Preserve original content for debugging
    };

  } catch (error) {
    console.error(`Conversion error for "${name}":`, error);
    return {
      success: false,
      error: error.message,
      type,
      name: sanitizeFilename(name),
      content: `# Conversion Error\n\nFailed to convert ${name}\nError: ${error.message}` // Add error content
    };
  }
}

const CATEGORIES = {
  multimedia: ['audio', 'video', 'mp3', 'mp4', 'wav', 'ogg', 'webm'],
  web: ['url', 'parenturl'],
  text: ['pdf', 'docx', 'pptx'],
  data: ['csv', 'xlsx']
};

function getCategory(type) {
  return Object.entries(CATEGORIES).find(([_, types]) => 
    types.includes(type.toLowerCase())
  )?.[0] || 'other';
}

/**
 * Generates a summary of converted items
 * @param {Array<Object>} items - Array of conversion results
 * @returns {string} - Markdown formatted summary
 */
function generateSummary(items) {
  const summary = ['# Conversion Summary\n'];
  const categories = new Map();
  let totalSuccess = 0;
  let totalErrors = 0;

  // Group items by category and count successes/errors
  items.forEach(item => {
    if (!item) return;
    
    const category = item.category || 'unknown';
    if (!categories.has(category)) {
      categories.set(category, { items: [], success: 0, errors: 0 });
    }
    
    const categoryData = categories.get(category);
    categoryData.items.push(item);
    
    if (item.success === false || item.error) {
      categoryData.errors++;
      totalErrors++;
    } else {
      categoryData.success++;
      totalSuccess++;
    }
  });

  // Add overall statistics
  summary.push(`## Overview\n`);
  summary.push(`- Total Items: ${items.length}`);
  summary.push(`- Successfully Converted: ${totalSuccess}`);
  summary.push(`- Errors: ${totalErrors}\n`);

  // Add category-specific information
  categories.forEach((data, category) => {
    summary.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
    summary.push(`- Total: ${data.items.length}`);
    summary.push(`- Successful: ${data.success}`);
    summary.push(`- Failed: ${data.errors}\n`);
    
    // List all items in category
    summary.push('### Items\n');
    data.items.forEach(item => {
      const status = item.success === false || item.error ? '❌' : '✅';
      const errorInfo = item.error ? ` - Error: ${item.error}` : '';
      summary.push(`- ${status} ${item.name}${errorInfo}`);
    });
    summary.push('');
  });

  return summary.join('\n');
}

/**
 * Creates a structured ZIP file from multiple converted items with memory optimization
 * @param {Array<Object>} items - Array of conversion results
 * @returns {Promise<Buffer>} - The ZIP file buffer
 */
export async function createBatchZip(items) {
  console.log('📦 Starting ZIP creation:', {
    itemCount: items.length,
    memory: process.memoryUsage()
  });

  const zip = new JSZip();
  const categories = new Map();

  // Add summary first
  const summary = generateSummary(items);
  zip.file('summary.md', summary);

  // Track memory usage
  const initialMemory = process.memoryUsage().heapUsed;
  let currentBatch = [];
  let batchSize = 0;
  const MAX_BATCH_SIZE = 25 * 1024 * 1024; // 25MB batch size
const MAX_MEMORY_USAGE = 512 * 1024 * 1024; // 512MB memory threshold

  // Process items in batches to manage memory
  for (const item of items) {
    try {
      if (!item) continue;

      const itemSize = calculateItemSize(item);
      if (batchSize + itemSize > MAX_BATCH_SIZE) {
        // Process current batch
        console.log('💾 Processing batch:', {
          items: currentBatch.length,
          batchSize: Math.round(batchSize / 1024 / 1024) + 'MB',
          memory: process.memoryUsage()
        });

        await processBatch(zip, currentBatch, categories);
        currentBatch = [];
        batchSize = 0;

        // Force garbage collection if available
        if (global.gc) {
          console.log('🧹 Running garbage collection');
          global.gc();
        }
      }

      currentBatch.push(item);
      batchSize += itemSize;
    } catch (error) {
      console.error('Error processing item for zip:', error);
    }
  }

  // Process remaining items
  if (currentBatch.length > 0) {
    console.log('💾 Processing final batch:', {
      items: currentBatch.length,
      batchSize: Math.round(batchSize / 1024 / 1024) + 'MB',
      memory: process.memoryUsage()
    });
    await processBatch(zip, currentBatch, categories);
  }

  // Clean up empty folders recursively
  cleanupFolders(zip);

  console.log('📦 Generating ZIP file:', {
    categories: Array.from(categories.keys()),
    memory: process.memoryUsage(),
    memoryChange: Math.round((process.memoryUsage().heapUsed - initialMemory) / 1024 / 1024) + 'MB'
  });

  // Generate ZIP with streaming support
  // Final garbage collection before ZIP generation
  if (global.gc) {
    console.log('🧹 Final garbage collection before ZIP generation');
    global.gc();
  }

  console.log('📦 Starting ZIP file generation');
  const startTime = Date.now();

  // Use lower compression level for better memory usage
  const result = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }, // Lower compression level for better performance
    streamFiles: true,
    comment: `Generated at ${new Date().toISOString()}`,
  }, (metadata) => {
    if (metadata.percent % 10 === 0) { // Log every 10%
      const elapsedTime = Date.now() - startTime;
      const estimatedTotalTime = (elapsedTime / metadata.percent) * 100;
      const remainingTime = estimatedTotalTime - elapsedTime;
      
      console.log(`📊 ZIP Generation Progress:`, {
        percent: Math.round(metadata.percent) + '%',
        currentFile: metadata.currentFile,
        elapsedTime: Math.round(elapsedTime/1000) + 's',
        estimatedRemaining: Math.round(remainingTime/1000) + 's',
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
      });
    }
  });

  console.log('✅ ZIP generation completed:', {
    duration: Math.round((Date.now() - startTime)/1000) + 's',
    finalSize: Math.round(result.length / 1024 / 1024) + 'MB',
    memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
  });

  return result;
}

/**
 * Calculate approximate size of an item for batching
 * @param {Object} item - The item to calculate size for
 * @returns {number} - Approximate size in bytes
 */
function calculateItemSize(item) {
  let size = 0;

  // Add size of main content
  if (item.content) {
    size += item.content.length;
  }

  // Add size of images
  if (item.images) {
    size += item.images.reduce((total, img) => total + (img.data ? img.data.length : 0), 0);
  }

  // Add size of additional files (from parent URL conversion)
  if (item.files && Array.isArray(item.files)) {
    size += item.files.reduce((total, file) => total + (file.content ? file.content.length : 0), 0);
  }

  return size;
}

/**
 * Process a batch of items
 * @param {JSZip} zip - The ZIP object
 * @param {Array} batch - Batch of items to process
 * @param {Map} categories - Categories map
 */
async function processBatch(zip, batch, categories) {
  const batchStartTime = Date.now();
  const batchStartMemory = process.memoryUsage().heapUsed;
  for (const item of batch) {
    const { content, images = [], name, type = 'unknown' } = item;
    const category = item.category || getCategory(type);
    categories.set(category, true);

    const categoryFolder = zip.folder(category);
    if (!categoryFolder) continue;

    const baseName = path.basename(name, path.extname(name));

    try {
      // Check memory usage before processing each item
      const currentMemory = process.memoryUsage().heapUsed;
      if (currentMemory > MAX_MEMORY_USAGE) {
        console.log('⚠️ Memory threshold reached:', Math.round(currentMemory / 1024 / 1024) + 'MB');
        if (global.gc) {
          console.log('🧹 Forcing garbage collection');
          global.gc();
          
          // If memory is still high after GC, wait a bit
          if (process.memoryUsage().heapUsed > MAX_MEMORY_USAGE) {
            console.log('⏳ Waiting for memory to settle...');
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }

      if (category === 'web') {
        await processWebContent(categoryFolder, baseName, content, images, item);
      } else {
        await processRegularContent(categoryFolder, category, baseName, content, images);
      }
    } catch (error) {
      console.error(`❌ Error processing item ${name}:`, error);
    }
  }

  const batchEndMemory = process.memoryUsage().heapUsed;
  const batchDuration = Date.now() - batchStartTime;
  console.log('📊 Batch processing completed:', {
    itemCount: batch.length,
    duration: Math.round(batchDuration/1000) + 's',
    memoryDelta: Math.round((batchEndMemory - batchStartMemory) / 1024 / 1024) + 'MB',
    currentMemory: Math.round(batchEndMemory / 1024 / 1024) + 'MB'
  });
}

/**
 * Process web content
 * @param {JSZip} categoryFolder - The category folder
 * @param {string} baseName - Base name for the content
 * @param {string} content - The content
 * @param {Array} images - Array of images
 */
async function processWebContent(categoryFolder, baseName, content, _, item) {
  console.log('🌐 Processing web content:', {
    baseName,
    hasContent: !!content,
    hasFiles: !!item.files
  });

  const siteFolder = categoryFolder.folder(baseName);
  if (!siteFolder) {
    console.error('Failed to create site folder:', baseName);
    return;
  }

  // Create pages directory
  const pagesFolder = siteFolder.folder('pages');

  // Add files in their proper locations
  if (item.files && Array.isArray(item.files)) {
    console.log(`📑 Processing ${item.files.length} markdown files`);
    for (const file of item.files) {
      try {
        if (!file.name || !file.content) {
          console.warn('⚠️ Skipping invalid file:', file.name);
          continue;
        }

        // Split path into parts and get the final part
        const pathParts = file.name.split('/');
        const finalPath = pathParts[pathParts.length - 1];

        // Add file to pages folder or root based on path
        if (finalPath.includes('index.md')) {
          siteFolder.file('index.md', file.content);
          console.log('📄 Added index.md to root');
        } else {
          pagesFolder.file(finalPath, file.content);
          console.log(`📄 Added ${finalPath} to pages/`);
        }
      } catch (error) {
        console.error('❌ Error processing file:', {
          name: file.name,
          error: error.message
        });
      }
    }
  } else {
    // If no files array, just add the content as index.md
    siteFolder.file('index.md', content);
    console.log('📄 Added single index.md file');
  }
}

/**
 * Process regular content
 * @param {JSZip} categoryFolder - The category folder
 * @param {string} category - Category name
 * @param {string} baseName - Base name for the content
 * @param {string} content - The content
 * @param {Array} images - Array of images
 */
async function processRegularContent(categoryFolder, category, baseName, content) {
  console.log(`📄 Processing regular content: ${baseName}`);
  categoryFolder.file(`${baseName}.md`, content);
}

/**
 * Clean up empty folders
 * @param {JSZip} zip - The ZIP object
 */
function cleanupFolders(zip) {
  if (!zip || !zip.files) return;
  
  zip.forEach((relativePath, file) => {
    if (file.dir && file.files && Object.keys(file.files).length === 0) {
      zip.remove(relativePath);
    }
  });
}
