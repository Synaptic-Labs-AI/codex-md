/**
 * Conversion Worker
 * 
 * Worker process for handling file conversions in isolation.
 * Receives conversion tasks via IPC, processes them, and returns results.
 * 
 * Related files:
 * - src/electron/services/WorkerManager.js: Worker manager
 * - backend/src/services/ConversionService.js: Core conversion logic
 * - src/electron/utils/serializationHelper.js: Serialization utilities
 */

const path = require('path');
const SerializationHelper = require('../utils/serializationHelper');
const workerImageTransfer = require('../utils/workerImageTransfer');

// Initialize helpers
const serializationHelper = new SerializationHelper();

// Flag to indicate this is a worker process
process.env.IS_WORKER = 'true';

// Set up error handling
process.on('uncaughtException', (error) => {
  console.error(`❌ [Worker] Uncaught exception:`, error);
  
  // Send error to parent process
  process.send({
    type: 'error',
    data: {
      message: error.message,
      stack: error.stack
    }
  });
  
  // Exit with error code
  process.exit(1);
});

// Listen for messages from parent process
/**
 * Convert content to Buffer if needed with enhanced handling for binary files
 * @param {*} content - The content to convert
 * @param {string} type - The file type
 * @returns {Buffer|*} - The content as Buffer if needed, otherwise unchanged
 */
function convertToBuffer(content, type) {
  // Log content type for debugging
  console.log(`🔄 [Worker] Converting content for type: ${type}, contentType: ${typeof content}, isBuffer: ${Buffer.isBuffer(content)}`);
  
  // If content is null or undefined, return as is
  if (content === null || content === undefined) {
    console.log(`⚠️ [Worker] Content is ${content === null ? 'null' : 'undefined'}`);
    return content;
  }
  
  // If already a Buffer, return as is
  if (Buffer.isBuffer(content)) {
    console.log(`✅ [Worker] Content is already a Buffer of length ${content.length}`);
    return content;
  }
  
  // If content is a string and type is url or parenturl, return as is
  if (typeof content === 'string') {
    if (['url', 'parenturl'].includes(type?.toLowerCase())) {
      console.log(`✅ [Worker] Content is a string URL: ${content.substring(0, 50)}...`);
      return content;
    } else if (content.startsWith('BASE64:')) {
      // Handle BASE64 prefixed content (used by frontend for binary files)
      console.log(`🔄 [Worker] Converting BASE64 prefixed string to Buffer`);
      const base64Data = content.substring(7); // Remove 'BASE64:' prefix
      return Buffer.from(base64Data, 'base64');
    } else {
      console.log(`✅ [Worker] Content is a string of length ${content.length}`);
      return content;
    }
  }
  
  // For binary file types, ensure content is a Buffer with enhanced handling
  const binaryTypes = ['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'doc', 'jpg', 'jpeg', 'png', 'gif'];
  if (binaryTypes.includes(type?.toLowerCase())) {
    console.log(`🔄 [Worker] Converting binary content for ${type}`);
    
    // Special handling for PDF and PPTX files
    if (['pdf', 'pptx'].includes(type?.toLowerCase())) {
      console.log(`🔍 [Worker] Special handling for ${type} file`);
      
      // If content is a Uint8Array, convert to Buffer
      if (content instanceof Uint8Array) {
        console.log(`🔄 [Worker] Converting Uint8Array to Buffer, length: ${content.length}`);
        return Buffer.from(content);
      }
      
      // If content is an Array, convert to Buffer
      if (Array.isArray(content)) {
        console.log(`🔄 [Worker] Converting Array to Buffer, length: ${content.length}`);
        return Buffer.from(content);
      }
      
      // If content is an object with a data property that is a string (base64), convert to Buffer
      if (content && typeof content === 'object' && typeof content.data === 'string') {
        console.log(`🔄 [Worker] Converting object with base64 data to Buffer`);
        return Buffer.from(content.data, 'base64');
      }
      
      // If content is an object with a buffer property, use that
      if (content && typeof content === 'object' && Buffer.isBuffer(content.buffer)) {
        console.log(`🔄 [Worker] Using buffer property from object, length: ${content.buffer.length}`);
        return content.buffer;
      }
      
      // If content is an object with a type property of 'Buffer' and a data property that is an array, convert to Buffer
      if (content && typeof content === 'object' && content.type === 'Buffer' && Array.isArray(content.data)) {
        console.log(`🔄 [Worker] Converting serialized Buffer object to Buffer, length: ${content.data.length}`);
        return Buffer.from(content.data);
      }
      
      // If content is a JSON-serialized Buffer, try to reconstruct it
      if (content && typeof content === 'object') {
        try {
          // Try to convert the object to a Buffer using various methods
          if (Object.prototype.toString.call(content) === '[object Object]') {
            // Check if it's a serialized Buffer-like object
            if (Array.isArray(content.data)) {
              console.log(`🔄 [Worker] Converting object with data array to Buffer, length: ${content.data.length}`);
              return Buffer.from(content.data);
            }
            
            // Try to convert the entire object to a Buffer
            console.log(`🔄 [Worker] Attempting to convert entire object to Buffer`);
            const jsonStr = JSON.stringify(content);
            return Buffer.from(jsonStr);
          }
        } catch (error) {
          console.error(`❌ [Worker] Error converting object to Buffer:`, error);
        }
      }
    }
    
    // General handling for all binary types
    
    // If content is a Uint8Array, convert to Buffer
    if (content instanceof Uint8Array) {
      console.log(`🔄 [Worker] Converting Uint8Array to Buffer, length: ${content.length}`);
      return Buffer.from(content);
    }
    
    // If content is an Array, convert to Buffer
    if (Array.isArray(content)) {
      console.log(`🔄 [Worker] Converting Array to Buffer, length: ${content.length}`);
      return Buffer.from(content);
    }
    
    // If content is an object with a data property that is a string (base64), convert to Buffer
    if (content && typeof content === 'object' && typeof content.data === 'string') {
      console.log(`🔄 [Worker] Converting object with base64 data to Buffer`);
      return Buffer.from(content.data, 'base64');
    }
    
    // If content is an object with a buffer property, use that
    if (content && typeof content === 'object' && Buffer.isBuffer(content.buffer)) {
      console.log(`🔄 [Worker] Using buffer property from object, length: ${content.buffer.length}`);
      return content.buffer;
    }
    
    // If content is an object with a type property of 'Buffer' and a data property that is an array, convert to Buffer
    if (content && typeof content === 'object' && content.type === 'Buffer' && Array.isArray(content.data)) {
      console.log(`🔄 [Worker] Converting serialized Buffer object to Buffer, length: ${content.data.length}`);
      return Buffer.from(content.data);
    }
    
    console.warn(`⚠️ [Worker] Could not convert content to Buffer for ${type}, type: ${typeof content}`);
    
    // For PDF and PPTX, throw an error if we couldn't convert to Buffer
    if (['pdf', 'pptx'].includes(type?.toLowerCase())) {
      throw new Error(`Invalid ${type.toUpperCase()}: Expected a buffer`);
    }
  }
  
  return content;
}

// Import specialized adapters for direct converter access
let urlConverterAdapter;
let pptxConverterAdapter;
let pdfConverterAdapter;

// Dynamically import specialized adapters
async function importSpecializedAdapters() {
  try {
    console.log(`🔄 [Worker] Importing specialized adapters...`);
    
    // Import URL converter adapter
    const urlAdapterPath = path.resolve(__dirname, '../adapters/urlConverterAdapter.js');
    urlConverterAdapter = require(urlAdapterPath);
    console.log(`✅ [Worker] Imported URL converter adapter`);
    
    // Import PPTX converter adapter
    const pptxAdapterPath = path.resolve(__dirname, '../adapters/pptxConverterAdapter.js');
    pptxConverterAdapter = require(pptxAdapterPath);
    console.log(`✅ [Worker] Imported PPTX converter adapter`);
    
    // Import PDF converter adapter
    const pdfAdapterPath = path.resolve(__dirname, '../adapters/pdfConverterAdapter.js');
    pdfConverterAdapter = require(pdfAdapterPath);
    console.log(`✅ [Worker] Imported PDF converter adapter`);
    
    console.log(`✅ [Worker] All specialized adapters imported successfully`);
  } catch (error) {
    console.error(`❌ [Worker] Error importing specialized adapters:`, error);
  }
}

// Import adapters on startup
importSpecializedAdapters();

process.on('message', async (message) => {
  if (message.type === 'convert') {
    try {
      // Convert Buffer-like objects back to Buffers
      const data = {
        ...message.data,
        item: {
          ...message.data.item,
          content: convertToBuffer(message.data.item.content, message.data.item.type)
        }
      };
      
      await handleConversion(data);
    } catch (error) {
      console.error(`❌ [Worker] Error processing message:`, error);
      
      // Send error to parent process
      process.send({
        type: 'error',
        data: {
          message: error.message,
          stack: error.stack,
          taskId: message.data?.id
        }
      });
    }
  }
});

/**
 * Handle a conversion task
 * @param {Object} task - Conversion task
 */
async function handleConversion(task) {
  console.log(`🔄 [Worker] Processing task: ${task.id}, type: ${task.item.type}`);
  
  try {
    // Set up progress tracking
    const onProgress = (progress) => {
      // Send progress update to parent process
      process.send({
        type: 'progress',
        data: {
          taskId: task.id,
          progress
        }
      });
    };
    
    // Add progress tracking to options
    const options = {
      ...task.options,
      onProgress
    };
    
    let result;
    
    // Handle special converter types directly
    const type = task.item.type.toLowerCase();
    
    if (type === 'url' && urlConverterAdapter) {
      console.log(`🔄 [Worker] Using specialized URL converter adapter`);
      result = await handleUrlConversion(task.item.content, task.item.name, options);
    } else if (type === 'parenturl' && urlConverterAdapter) {
      console.log(`🔄 [Worker] Using specialized Parent URL converter adapter`);
      result = await handleParentUrlConversion(task.item.content, task.item.name, options);
    } else if (type === 'pptx' && pptxConverterAdapter) {
      console.log(`🔄 [Worker] Using specialized PPTX converter adapter`);
      result = await handlePptxConversion(task.item.content, task.item.name, task.item.apiKey, options);
    } else if (type === 'pdf' && pdfConverterAdapter) {
      console.log(`🔄 [Worker] Using specialized PDF converter adapter`);
      result = await handlePdfConversion(task.item.content, task.item.name, task.item.apiKey, options);
    } else {
      console.log(`🔄 [Worker] Using ConversionService for type: ${type}`);
      
      // Import the ConversionService dynamically
      // Note: The backend uses ES modules while Electron uses CommonJS
      const ConversionServiceModule = await import('../../../backend/src/services/ConversionService.js');
      
      // Get the ConversionService class (exported as named export)
      const ConversionService = ConversionServiceModule.ConversionService;
      
      // Create a new instance of the ConversionService
      const conversionService = new ConversionService();
      
      // Process the item
      result = await conversionService.processItem({
        ...task.item,
        options
      });
    }
    
    // Validate result
    if (!result) {
      throw new Error(`Conversion returned null or undefined result for ${task.item.type}`);
    }
    
    if (!result.content && !result.error) {
      console.warn(`⚠️ [Worker] Conversion result has no content for ${task.item.type}`);
      result.content = `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: No content generated`;
      result.success = false;
    }
    
    // Convert image buffers to file paths if present
    if (result.images && Array.isArray(result.images) && result.images.length > 0) {
      try {
        console.log(`🖼️ [Worker] Converting ${result.images.length} images to file paths`);
        result.images = await workerImageTransfer.convertImagesToFilePaths(result.images);
      } catch (error) {
        console.error(`❌ [Worker] Error converting images to file paths:`, error);
        // If image conversion fails, continue without images
        result.images = [];
      }
    }
    
    // Ensure result has success property
    if (result.success === undefined) {
      result.success = !!result.content;
    }
    
    // Sanitize the result after converting images
    const sanitizedResult = serializationHelper.sanitizeForSerialization(result);
    
    // Send result to parent process
    process.send({
      type: 'result',
      data: sanitizedResult
    });
    
    console.log(`✅ [Worker] Task completed: ${task.id}`);
  } catch (error) {
    console.error(`❌ [Worker] Error processing task:`, error);
    
    // Create error result
    const errorResult = {
      success: false,
      error: error.message,
      name: task.item.name,
      type: task.item.type,
      content: `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: ${error.message}`
    };
    
    // Send error result to parent process
    process.send({
      type: 'result',
      data: errorResult
    });
    
    // Also send detailed error for logging
    process.send({
      type: 'error',
      data: {
        message: error.message,
        stack: error.stack,
        taskId: task.id
      }
    });
  }
}

/**
 * Handle URL conversion using specialized adapter
 */
async function handleUrlConversion(url, name, options) {
  console.log(`🔄 [Worker] Converting URL: ${url}`);
  
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL: URL must be a string');
    }
    
    const result = await urlConverterAdapter.convertUrl(url, options);
    
    if (!result) {
      throw new Error('URL conversion returned null or undefined result');
    }
    
    return {
      ...result,
      success: true,
      type: 'url',
      name: name || result.name
    };
  } catch (error) {
    console.error(`❌ [Worker] URL conversion error:`, error);
    throw new Error(`URL conversion failed: ${error.message}`);
  }
}

/**
 * Handle Parent URL conversion using specialized adapter
 */
async function handleParentUrlConversion(url, name, options) {
  console.log(`🔄 [Worker] Converting Parent URL: ${url}`);
  
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL: URL must be a string');
    }
    
    const result = await urlConverterAdapter.convertUrl(url, {
      ...options,
      isParentUrl: true
    });
    
    if (!result) {
      throw new Error('Parent URL conversion returned null or undefined result');
    }
    
    return {
      ...result,
      success: true,
      type: 'parenturl',
      name: name || result.name
    };
  } catch (error) {
    console.error(`❌ [Worker] Parent URL conversion error:`, error);
    throw new Error(`Parent URL conversion failed: ${error.message}`);
  }
}

/**
 * Handle PPTX conversion using specialized adapter
 */
async function handlePptxConversion(content, name, apiKey, options) {
  console.log(`🔄 [Worker] Converting PPTX: ${name}`);
  
  try {
    if (!content || !Buffer.isBuffer(content)) {
      throw new Error('Invalid PPTX: Expected a buffer');
    }
    
    const result = await pptxConverterAdapter.convertPptxToMarkdown(content, name, apiKey);
    
    if (!result) {
      throw new Error('PPTX conversion returned null or undefined result');
    }
    
    return {
      ...result,
      success: true,
      type: 'pptx',
      name
    };
  } catch (error) {
    console.error(`❌ [Worker] PPTX conversion error:`, error);
    throw new Error(`PPTX conversion failed: ${error.message}`);
  }
}

/**
 * Handle PDF conversion using specialized adapter
 */
async function handlePdfConversion(content, name, apiKey, options) {
  console.log(`🔄 [Worker] Converting PDF: ${name}`);
  
  try {
    if (!content || !Buffer.isBuffer(content)) {
      throw new Error('Invalid PDF: Expected a buffer');
    }
    
    const result = await pdfConverterAdapter.convertPdfToMarkdown(content, name, apiKey);
    
    if (!result) {
      throw new Error('PDF conversion returned null or undefined result');
    }
    
    return {
      ...result,
      success: true,
      type: 'pdf',
      name
    };
  } catch (error) {
    console.error(`❌ [Worker] PDF conversion error:`, error);
    throw new Error(`PDF conversion failed: ${error.message}`);
  }
}

// Signal that the worker is ready
console.log(`🚀 [Worker] Conversion worker started (PID: ${process.pid})`);
