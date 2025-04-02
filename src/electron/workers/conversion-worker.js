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

// Initialize serialization helper
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
process.on('message', async (message) => {
  if (message.type === 'convert') {
    await handleConversion(message.data);
  }
});

/**
 * Handle a conversion task
 * @param {Object} task - Conversion task
 */
async function handleConversion(task) {
  console.log(`🔄 [Worker] Processing task: ${task.id}`);
  
  try {
    // Import the ConversionService dynamically
    // Note: The backend uses ES modules while Electron uses CommonJS
    const ConversionServiceModule = await import('../../../backend/src/services/ConversionService.js');
    
    // Get the ConversionService class (exported as named export)
    const ConversionService = ConversionServiceModule.ConversionService;
    
    // Create a new instance of the ConversionService
    const conversionService = new ConversionService();
    
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
    
    // Process the item
    const result = await conversionService.processItem({
      ...task.item,
      options
    });
    
    // Sanitize the result to ensure it can be serialized
    const sanitizedResult = serializationHelper.sanitizeForSerialization(result);
    
    // Send result to parent process
    process.send({
      type: 'result',
      data: sanitizedResult
    });
    
    console.log(`✅ [Worker] Task completed: ${task.id}`);
  } catch (error) {
    console.error(`❌ [Worker] Error processing task:`, error);
    
    // Send error to parent process
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

// Signal that the worker is ready
console.log(`🚀 [Worker] Conversion worker started (PID: ${process.pid})`);