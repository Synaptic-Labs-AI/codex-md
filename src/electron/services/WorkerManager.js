/**
 * Worker Manager Service
 * 
 * Manages a pool of worker processes for file conversion tasks.
 * Creates and destroys workers as needed, distributes tasks, and collects results.
 * 
 * Related files:
 * - src/electron/workers/conversion-worker.js: Worker script
 * - src/electron/services/ElectronConversionService.js: Main conversion service
 * - src/electron/utils/serializationHelper.js: Serialization utilities
 */

const { fork } = require('child_process');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const SerializationHelper = require('../utils/serializationHelper');
const workerImageTransfer = require('../utils/workerImageTransfer');

class WorkerManager {
  constructor(options = {}) {
    this.maxWorkers = options.maxWorkers || 4;
    this.workerScript = options.workerScript || path.join(__dirname, '../workers/conversion-worker.js');
    this.serializationHelper = new SerializationHelper();
    this.activeWorkers = new Map();
    this.taskQueue = [];
    this.isProcessing = false;
  }

  /**
   * Process a batch of files using worker processes
   * @param {Array} items - Array of items to convert
   * @param {Object} options - Conversion options
   * @returns {Promise<Object>} - Batch conversion result
   */
  async processBatch(items, options = {}) {
    console.log(`🔄 [WorkerManager] Processing batch of ${items.length} items`);
    
    try {
      // Sanitize items to ensure they can be serialized
      const sanitizedItems = items.map(item => this.serializationHelper.sanitizeForSerialization(item));
      
      // Create a unique batch ID
      const batchId = uuidv4();
      
      // Create task objects
      const tasks = sanitizedItems.map((item, index) => ({
        id: item.id || `task-${index}`,
        batchId,
        item,
        options: this.serializationHelper.sanitizeForSerialization(options)
      }));
      
      // Process all tasks and collect results
      const results = await this._processTasks(tasks, options);
      
      // Combine and return results
      return {
        results,
        stats: {
          totalItems: items.length,
          successfulItems: results.filter(r => r.success).length,
          failedItems: results.filter(r => !r.success).length,
          duration: Date.now() - (this._batchStartTime || Date.now())
        }
      };
    } catch (error) {
      console.error(`❌ [WorkerManager] Batch processing error:`, error);
      throw error;
    }
  }

  /**
   * Process tasks using available workers
   * @param {Array} tasks - Array of tasks to process
   * @param {Object} options - Processing options
   * @returns {Promise<Array>} - Array of results
   * @private
   */
  async _processTasks(tasks, options = {}) {
    this._batchStartTime = Date.now();
    
    // Create a promise that will resolve when all tasks are complete
    return new Promise((resolve, reject) => {
      const results = new Array(tasks.length);
      let completedTasks = 0;
      
      // Function to check if all tasks are complete
      const checkCompletion = () => {
        if (completedTasks === tasks.length) {
          // Clean up workers
          this._cleanupWorkers();
          resolve(results);
        }
      };
      
      // Function to process a single task
      const processTask = async (taskIndex) => {
        const task = tasks[taskIndex];
        
        try {
          // Create a worker for this task
          const worker = this._createWorker();
          
          // Set up message handler
          worker.on('message', async (message) => {
            if (message.type === 'result') {
              try {
                // Check for file-based images that need to be converted back to buffers
                if (message.data.images && Array.isArray(message.data.images) && 
                    message.data.images.some(img => img._isWorkerTransfer)) {
                  try {
                    console.log(`🖼️ [WorkerManager] Converting ${message.data.images.length} images from file paths to buffers`);
                    message.data.images = await workerImageTransfer.convertFilePathsToImages(message.data.images);
                    
                    // Clean up temp files after successful conversion
                    await workerImageTransfer.cleanupTempFiles(message.data.images);
                  } catch (error) {
                    console.error(`❌ [WorkerManager] Error converting images from file paths:`, error);
                    // If image conversion fails, remove images array to prevent issues
                    message.data.images = [];
                  }
                }
                
                // Store the result
                results[taskIndex] = message.data;
                completedTasks++;
                
                // Terminate the worker
                worker.kill();
                
                // Check if all tasks are complete
                checkCompletion();
                
                // Process next task if available
                const nextTaskIndex = tasks.findIndex((_, i) => !results[i] && !this.activeWorkers.has(i));
                if (nextTaskIndex !== -1 && !this.activeWorkers.has(nextTaskIndex)) {
                  processTask(nextTaskIndex);
                }
              } catch (error) {
                console.error(`❌ [WorkerManager] Error processing result:`, error);
                // Store error result
                results[taskIndex] = {
                  success: false,
                  error: error.message || 'Error processing result',
                  name: task.item.name,
                  type: task.item.type,
                  content: `# Conversion Error\n\nFailed to process result for ${task.item.name}\nError: ${error.message || 'Error processing result'}`
                };
                completedTasks++;
                worker.kill();
                checkCompletion();
              }
            } else if (message.type === 'progress') {
              // Forward progress updates
              if (options.onProgress) {
                options.onProgress({
                  id: task.id,
                  index: taskIndex,
                  progress: message.data.progress,
                  file: task.item.name
                });
              }
            } else if (message.type === 'error') {
              console.error(`❌ [WorkerManager] Worker error:`, message.data);
              
              // Store error result
              results[taskIndex] = {
                success: false,
                error: message.data.message || 'Unknown worker error',
                name: task.item.name,
                type: task.item.type,
                content: `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: ${message.data.message || 'Unknown worker error'}`
              };
              
              completedTasks++;
              
              // Terminate the worker
              worker.kill();
              
              // Check if all tasks are complete
              checkCompletion();
              
              // Process next task if available
              const nextTaskIndex = tasks.findIndex((_, i) => !results[i] && !this.activeWorkers.has(i));
              if (nextTaskIndex !== -1 && !this.activeWorkers.has(nextTaskIndex)) {
                processTask(nextTaskIndex);
              }
            }
          });
          
          // Set up error handler
          worker.on('error', (error) => {
            console.error(`❌ [WorkerManager] Worker process error:`, error);
            
            // Store error result
            results[taskIndex] = {
              success: false,
              error: error.message || 'Worker process error',
              name: task.item.name,
              type: task.item.type,
              content: `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: ${error.message || 'Worker process error'}`
            };
            
            completedTasks++;
            
            // Check if all tasks are complete
            checkCompletion();
            
            // Process next task if available
            const nextTaskIndex = tasks.findIndex((_, i) => !results[i] && !this.activeWorkers.has(i));
            if (nextTaskIndex !== -1 && !this.activeWorkers.has(nextTaskIndex)) {
              processTask(nextTaskIndex);
            }
          });
          
          // Set up exit handler
          worker.on('exit', (code) => {
            this.activeWorkers.delete(taskIndex);
            
            if (code !== 0 && !results[taskIndex]) {
              // Store error result if not already stored
              results[taskIndex] = {
                success: false,
                error: `Worker exited with code ${code}`,
                name: task.item.name,
                type: task.item.type,
                content: `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: Worker exited with code ${code}`
              };
              
              completedTasks++;
              
              // Check if all tasks are complete
              checkCompletion();
            }
          });
          
          // Store worker reference
          this.activeWorkers.set(taskIndex, worker);
          
          // Send task to worker
          worker.send({
            type: 'convert',
            data: task
          });
        } catch (error) {
          console.error(`❌ [WorkerManager] Error processing task:`, error);
          
          // Store error result
          results[taskIndex] = {
            success: false,
            error: error.message || 'Error processing task',
            name: task.item.name,
            type: task.item.type,
            content: `# Conversion Error\n\nFailed to convert ${task.item.name}\nError: ${error.message || 'Error processing task'}`
          };
          
          completedTasks++;
          
          // Check if all tasks are complete
          checkCompletion();
          
          // Process next task if available
          const nextTaskIndex = tasks.findIndex((_, i) => !results[i] && !this.activeWorkers.has(i));
          if (nextTaskIndex !== -1 && !this.activeWorkers.has(nextTaskIndex)) {
            processTask(nextTaskIndex);
          }
        }
      };
      
      // Start processing tasks up to maxWorkers
      const initialBatch = Math.min(tasks.length, this.maxWorkers);
      for (let i = 0; i < initialBatch; i++) {
        processTask(i);
      }
    });
  }

  /**
   * Create a new worker process
   * @returns {ChildProcess} - Worker process
   * @private
   */
  _createWorker() {
    console.log(`🔄 [WorkerManager] Creating new worker process`);
    
    const worker = fork(this.workerScript, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        WORKER_PROCESS: 'true'
      }
    });
    
    return worker;
  }

  /**
   * Clean up all active workers
   * @private
   */
  _cleanupWorkers() {
    console.log(`🧹 [WorkerManager] Cleaning up ${this.activeWorkers.size} workers`);
    
    for (const worker of this.activeWorkers.values()) {
      try {
        worker.kill();
      } catch (error) {
        console.error(`❌ [WorkerManager] Error killing worker:`, error);
      }
    }
    
    this.activeWorkers.clear();
  }
}

module.exports = WorkerManager;
