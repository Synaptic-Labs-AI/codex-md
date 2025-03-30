import { textConverterFactory } from './converter/textConverterFactory.js';
import { createBatchZip } from '../routes/middleware/utils/zipProcessor.js';
import { determineCategory } from '../utils/fileTypeUtils.js';
import path from 'path';

export class ConversionService {
  constructor() {
    this.converter = textConverterFactory;
    this.progressUpdateInterval = 250; // Update progress every 250ms
  }

  async convert(data) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    let lastProgressUpdate = 0;
    
    console.log('🔄 Starting conversion:', {
        type: data.type,
        name: data.name,
        contentType: typeof data.content,
        isBuffer: Buffer.isBuffer(data.content),
        contentLength: data.content?.length,
        mimeType: data.mimeType,
        initialMemory: {
          heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024) + 'MB'
        }
    });

    if (global.gc && initialMemory.heapUsed > 0.8 * initialMemory.heapTotal) {
      console.log('🧹 Running initial garbage collection');
      global.gc();
    }

    try {
      const { type, content, name, apiKey, options = {}, mimeType } = data;
      
      if (!type || !content) {
        throw new Error('Missing required conversion parameters');
      }

      const FILE_SIGNATURES = {
        docx: {
          bytes: [0x50, 0x4B, 0x03, 0x04],
          description: 'DOCX/ZIP signature'
        },
        pdf: {
          bytes: [0x25, 0x50, 0x44, 0x46],
          description: 'PDF signature'
        },
        doc: {
          bytes: [0xD0, 0xCF, 0x11, 0xE0],
          description: 'DOC signature'
        },
        pptx: {
          bytes: [0x50, 0x4B, 0x03, 0x04],
          description: 'PPTX/ZIP signature'
        }
      };

      let processedContent;
      const normalizedType = type.toLowerCase();

      console.log('🔄 Processing content:', {
        type: normalizedType,
        contentType: typeof content,
        isBuffer: Buffer.isBuffer(content),
        isUint8Array: content instanceof Uint8Array,
        size: content?.length
      });

      // Progress tracking function
      const updateProgress = (progress) => {
        const now = Date.now();
        if (options.onProgress && now - lastProgressUpdate >= this.progressUpdateInterval) {
          options.onProgress(Math.min(Math.round(progress), 100));
          lastProgressUpdate = now;
        }
      };

      // Initial progress update
      updateProgress(0);

      if (['url', 'parenturl'].includes(normalizedType)) {
        console.log('🌐 Processing web content');
        processedContent = content;
        updateProgress(10);
      } else if (['docx', 'pdf', 'doc', 'pptx'].includes(normalizedType)) {
        console.log('📄 Processing document file');
        
        if (!Buffer.isBuffer(content)) {
          if (content instanceof Uint8Array) {
            console.log('🔄 Converting Uint8Array to Buffer');
            processedContent = Buffer.from(content);
          } else {
            console.error('❌ Invalid content type:', typeof content);
            throw new Error(`Invalid content type for ${type}: Expected Buffer or Uint8Array`);
          }
        } else {
          console.log('📦 Creating buffer copy');
          processedContent = Buffer.from(content);
        }

        const fileSignature = FILE_SIGNATURES[normalizedType];
        if (fileSignature) {
          console.log('🔐 Validating file signature:', {
            type: normalizedType,
            expectedSignature: Buffer.from(fileSignature.bytes).toString('hex'),
            actualSignature: processedContent.slice(0, 4).toString('hex'),
            description: fileSignature.description
          });

          if (!processedContent.slice(0, 4).equals(Buffer.from(fileSignature.bytes))) {
            throw new Error(`Invalid ${type.toUpperCase()} file signature: Expected ${fileSignature.description}`);
          }
        }
        updateProgress(20);
      } else {
        console.log('📄 Processing generic content');
        processedContent = content;
        updateProgress(10);
      }

      const logSignatureValidation = () => {
        if (!Buffer.isBuffer(processedContent)) return null;
        
        const signature = processedContent.slice(0, 4).toString('hex');
        const expectedSignature = FILE_SIGNATURES[normalizedType]?.bytes;
        
        return {
          hex: processedContent.slice(0, 8).toString('hex'),
          signature,
          isValidSignature: expectedSignature ? 
            expectedSignature.every((byte, i) => processedContent[i] === byte) : 
            true,
          description: FILE_SIGNATURES[normalizedType]?.description || 'Unknown format'
        };
      };

      console.log('📝 Converting content:', {
        type: normalizedType,
        name,
        contentType: typeof processedContent,
        isBuffer: Buffer.isBuffer(processedContent),
        length: processedContent?.length,
        preview: Buffer.isBuffer(processedContent) 
          ? logSignatureValidation()
          : typeof processedContent === 'string' 
            ? processedContent.substring(0, 50) 
            : 'N/A',
        options: {
          ...options,
          apiKey: options.apiKey ? '***' : undefined
        }
      });

      if (data.mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation') {
        data.type = 'pptx';
      }

      const fileType = path.extname(name).slice(1).toLowerCase();
      const category = determineCategory(type, fileType);
      
      if (this.requiresApiKey(fileType) && !apiKey) {
        throw new Error('API key is required for audio/video conversion');
      }

      updateProgress(30);

      console.log('🔄 Initiating conversion with converter:', {
        type,
        name,
        hasApiKey: !!apiKey,
        mimeType,
        optionsProvided: Object.keys(options || {})
      });

      let result;
      try {
        // Add progress callback to options
        const conversionOptions = {
          name,
          apiKey,
          mimeType,
          ...options,
          onProgress: (conversionProgress) => {
            // Scale progress from 30-90%
            const scaledProgress = 30 + (conversionProgress * 0.6);
            updateProgress(scaledProgress);
          }
        };

        result = await this.converter.convertToMarkdown(
          type,
          processedContent,
          conversionOptions
        );

        updateProgress(90);
      } catch (conversionError) {
        console.error('❌ Conversion error:', {
          error: conversionError.message,
          type,
          name,
          stack: conversionError.stack
        });
        
        if (conversionError.message.includes('timed out')) {
          throw new Error(`Conversion timed out for ${name} - file may be too large or complex`);
        }
        
        if (conversionError.message.includes('memory')) {
          throw new Error(`Memory limit exceeded while converting ${name}`);
        }
        
        throw conversionError;
      }

      if (!result || !result.content) {
        console.error('❌ Invalid conversion result:', {
          type,
          name,
          hasResult: !!result,
          resultKeys: result ? Object.keys(result) : []
        });
        throw new Error(`Conversion failed for ${name} - invalid result`);
      }

      try {
        const preZipMemory = process.memoryUsage();
        if (global.gc && preZipMemory.heapUsed > 0.8 * preZipMemory.heapTotal) {
          console.log('🧹 Running pre-ZIP garbage collection');
          global.gc();
        }

        updateProgress(95);

        console.log('📦 Creating ZIP archive:', {
          type: fileType,
          category,
          name,
          contentLength: result.content.length,
          hasImages: result.images?.length > 0,
          imageCount: result.images?.length || 0,
          memory: {
            heapUsed: Math.round(preZipMemory.heapUsed / 1024 / 1024) + 'MB',
            heapTotal: Math.round(preZipMemory.heapTotal / 1024 / 1024) + 'MB'
          }
        });

        const shouldCreateZip = 
          type === 'parenturl' || 
          (result.images && result.images.length > 0 && !['url', 'parenturl'].includes(type));

        let finalResult;
        if (!shouldCreateZip) {
          const baseName = path.basename(name, path.extname(name));
          finalResult = {
            buffer: Buffer.from(result.content),
            filename: `${baseName}.md`,
            type: 'markdown'
          };
        } else {
          const zipBuffer = await createBatchZip([{
            ...result,
            type: fileType,
            category,
            name
          }]);

          if (global.gc) {
            console.log('🧹 Running post-ZIP garbage collection');
            global.gc();
          }

          finalResult = {
            buffer: zipBuffer,
            filename: this.generateFilename(),
            type: 'zip'
          };
        }

        updateProgress(100);

        const endMemory = process.memoryUsage();
        console.log('✅ Conversion completed:', {
          type: fileType,
          name,
          duration: Date.now() - startTime + 'ms',
          finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB',
          memoryChange: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
        });

        return finalResult;
      } catch (zipError) {
        console.error('❌ ZIP creation failed:', {
          error: zipError.message,
          type: fileType,
          name,
          memory: process.memoryUsage(),
          duration: Date.now() - startTime + 'ms'
        });
        throw new Error(`Failed to create ZIP archive for ${name}: ${zipError.message}`);
      }
    } catch (error) {
      console.error('❌ Conversion error:', {
        error: error.message,
        type: data.type,
        name: data.name,
        stack: error.stack
      });
      throw error;
    }
  }

  async convertBatch(items) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    const CHUNK_SIZE = 10;

    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('No items provided for batch conversion');
    }

    try {
      console.log('🎯 Starting batch conversion:', {
        totalItems: items.length,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      const results = [];
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        console.log(`📦 Processing chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(items.length/CHUNK_SIZE)}`);

        const chunkResults = await Promise.all(
          chunk.map(async (item) => {
            try {
              if (!item) return null;
              
              const fileType = path.extname(item.name || '').slice(1).toLowerCase();
              const category = determineCategory(item.type, fileType);
              
              console.log(`Converting item: ${item.name} (${item.type})`);

              if (this.requiresApiKey(item.type) && !item.apiKey) {
                throw new Error(`API key required for ${item.type} conversion`);
              }

              const result = await this.processItem(item);
              return {
                ...result,
                id: item.id,
                category,
                type: item.type,
                name: item.name
              };
            } catch (error) {
              console.error(`Error converting item ${item.name}:`, error);
              return {
                id: item.id,
                name: item.name,
                type: item.type,
                category: 'error',
                success: false,
                error: error.message,
                content: `# Conversion Error\n\nFailed to convert ${item.name}\nError: ${error.message}`
              };
            }
          })
        );

        if (global.gc && process.memoryUsage().heapUsed > 512 * 1024 * 1024) {
          console.log('🧹 Running garbage collection between chunks');
          global.gc();
        }

        results.push(...chunkResults);
      }

      const validResults = results.filter(Boolean);

      console.log('📊 Batch processing completed:', {
        totalItems: items.length,
        successfulItems: validResults.filter(r => r.success).length,
        failedItems: validResults.filter(r => !r.success).length,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      
      console.log('📦 Creating batch ZIP archive');
      const zipBuffer = await createBatchZip(validResults);
      
      const endMemory = process.memoryUsage();
      console.log('✅ Batch conversion completed:', {
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB',
        finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      return {
        buffer: zipBuffer,
        filename: this.generateFilename(),
        stats: {
          totalItems: items.length,
          successfulItems: validResults.filter(r => r.success).length,
          failedItems: validResults.filter(r => !r.success).length,
          duration: Date.now() - startTime
        }
      };
    } catch (error) {
      console.error('Batch conversion failed:', error);
      throw error;
    }
  }

  async processItem(item) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();
    
    try {
      const { type, content, name, options = {} } = item;
      const fileType = path.extname(name).slice(1).toLowerCase();
      const category = determineCategory(type, fileType);
      const converterType = this.getConverterType(type, fileType);

      console.log('🔄 Processing item:', {
        name,
        type,
        category,
        size: content?.length,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const processOptions = {
        ...options,
        streamProcessing: true,
        memoryLimit: 512 * 1024 * 1024,
        chunkSize: content?.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined
      };

      if (fileType === 'csv' || fileType === 'xlsx') {
        console.log('📊 Processing data file:', { name, category, type: fileType });
        return this.handleDataFileConversion(fileType, content, name, processOptions);
      }

      let result;
      switch (type) {
        case 'parenturl':
          result = await this.handleParentUrlConversion(content, name, processOptions);
          break;
        case 'url':
          result = await this.handleUrlConversion(content, name, processOptions);
          break;
        default:
          result = await this.handleFileConversion(converterType, content, name, processOptions);
      }

      const endMemory = process.memoryUsage();
      console.log('✅ Item processed:', {
        name,
        type,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      return result;
    } catch (error) {
      console.error('❌ Item processing failed:', {
        name: item?.name,
        type: item?.type,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      throw error;
    }
  }

  async handleParentUrlConversion(url, name, options = {}) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();

    try {
      console.log('🌐 Processing parent URL:', {
        url,
        name,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const result = await this.converter.convertToMarkdown('parenturl', url, {
        name,
        ...options,
        streamProcessing: true,
        memoryLimit: 512 * 1024 * 1024,
        chunkSize: 50
      });

      const endMemory = process.memoryUsage();
      console.log('✅ Parent URL processed:', {
        url,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      return {
        ...result,
        type: 'parenturl',
        category: 'web',
        name,
        success: true
      };
    } catch (error) {
      console.error('❌ Parent URL processing failed:', {
        url,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      throw error;
    }
  }

  async handleUrlConversion(url, name, options = {}) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();

    try {
      console.log('🌐 Processing URL:', {
        url,
        name,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const result = await this.converter.convertToMarkdown('url', url, {
        name,
        ...options,
        streamProcessing: true,
        memoryLimit: 512 * 1024 * 1024
      });

      const endMemory = process.memoryUsage();
      console.log('✅ URL processed:', {
        url,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      return {
        ...result,
        type: 'url',
        category: 'web',
        name,
        success: true
      };
    } catch (error) {
      console.error('❌ URL processing failed:', {
        url,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      throw error;
    }
  }

  async handleFileConversion(type, content, name, options) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();

    try {
      if (!content) {
        throw new Error(`No content provided for file conversion: ${name}`);
      }

      console.log('📄 Processing file:', {
        name,
        type,
        size: content?.length,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const result = await this.converter.convertToMarkdown(type, content, {
        name,
        ...options,
        streamProcessing: true,
        memoryLimit: 512 * 1024 * 1024,
        chunkSize: content?.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined
      });

      const category = determineCategory(type, path.extname(name).slice(1));
      
      const endMemory = process.memoryUsage();
      console.log('✅ File processed:', {
        name,
        type,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      return {
        ...result,
        success: true,
        type,
        category,
        name,
        options,
        contentLength: result.content?.length || 0,
        imageCount: result.images?.length || 0
      };
    } catch (error) {
      console.error('❌ File conversion failed:', {
        name,
        type,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      return {
        success: false,
        error: error.message,
        type,
        name,
        content: `# Conversion Error\n\nFailed to convert ${name}\nError: ${error.message}`
      };
    }
  }

  async handleDataFileConversion(type, content, name, options) {
    const startTime = Date.now();
    const initialMemory = process.memoryUsage();

    try {
      console.log('📊 Processing data file:', {
        name,
        type,
        size: content?.length,
        initialMemory: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      if (global.gc && initialMemory.heapUsed > 512 * 1024 * 1024) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const result = await this.converter.convertToMarkdown(
        type,
        content,
        {
          name,
          ...options,
          streamProcessing: true,
          memoryLimit: 512 * 1024 * 1024,
          chunkSize: content?.length > 50 * 1024 * 1024 ? 25 * 1024 * 1024 : undefined
        }
      );

      const endMemory = process.memoryUsage();
      console.log('✅ Data file processed:', {
        name,
        type,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((endMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });

      return {
        ...result,
        success: true,
        type,
        category: 'data',
        name,
        options
      };
    } catch (error) {
      console.error('❌ Data file conversion failed:', {
        name,
        type,
        error: error.message,
        duration: Math.round((Date.now() - startTime)/1000) + 's',
        memoryUsed: Math.round((process.memoryUsage().heapUsed - initialMemory.heapUsed) / 1024 / 1024) + 'MB'
      });
      return {
        success: false,
        error: error.message,
        type,
        name,
        content: `# Conversion Error\n\nFailed to convert ${name}\nError: ${error.message}`
      };
    }
  }

  getConverterType(type, fileType) {
    if (type === 'video' || ['mp4', 'webm', 'avi'].includes(fileType)) {
      return 'video';
    }
    if (type === 'url') return 'url';
    if (type === 'parenturl') return 'parenturl';
    return fileType;
  }

  generateFilename() {
    return `conversion_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
  }

  isAudioExtension(ext) {
    return ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'].includes(ext.toLowerCase());
  }

  requiresApiKey(type) {
    return this.isAudioExtension(type) || this.isVideoExtension(type);
  }

  isVideoExtension(ext) {
    return ['mp4', 'webm', 'avi'].includes(ext.toLowerCase());
  }
}
