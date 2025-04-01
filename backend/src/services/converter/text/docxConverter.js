// services/converter/text/docxConverter.js

import mammoth from 'mammoth';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { htmlToMarkdown, cleanMarkdown } from '../web/utils/htmlToMarkdown.js';
import { JSDOM } from 'jsdom';

/**
 * Converts a DOCX buffer to Markdown format while properly handling images
 * @param {Buffer} buffer - The DOCX file buffer
 * @param {string} originalName - Original filename for context
 * @param {Object} [options] - Conversion options
 * @param {boolean} [options.preservePageInfo=false] - Whether to preserve page information
 * @returns {Promise<{content: string, images: Array, pageBreaks: Array}>} Markdown content, images, and page breaks
 */
export async function convertDocxToMarkdown(buffer, originalName, options = {}) {
  const startTime = Date.now();
  
  try {
    // Enhanced buffer validation with detailed logging
    console.log('🔍 Validating input buffer:', {
      type: typeof buffer,
      isBuffer: Buffer.isBuffer(buffer),
      isUint8Array: buffer instanceof Uint8Array,
      length: buffer?.length
    });

    if (!Buffer.isBuffer(buffer)) {
      if (buffer instanceof Uint8Array) {
        console.log('📝 Converting Uint8Array to Buffer');
        buffer = Buffer.from(buffer);
      } else {
        console.error('❌ Invalid buffer type:', typeof buffer);
        throw new Error(`Invalid input: Expected buffer or Uint8Array, got ${typeof buffer}`);
      }
    }

    // Create a copy of the buffer to prevent modifications
    const workingBuffer = Buffer.from(buffer);

    console.log('🚀 Starting DOCX conversion:', {
      originalName,
      bufferLength: workingBuffer.length,
      bufferType: typeof workingBuffer,
      isBuffer: Buffer.isBuffer(workingBuffer),
      firstBytes: workingBuffer.slice(0, 4).toString('hex'),
      signature: workingBuffer.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])) ? 'Valid DOCX' : 'Invalid DOCX'
    });

    // Enhanced DOCX structure validation
    if (workingBuffer.length < 4) {
      console.error('❌ Buffer too small:', workingBuffer.length, 'bytes');
      throw new Error(`Invalid DOCX format: Buffer too small (${workingBuffer.length} bytes)`);
    }

    const signature = workingBuffer.slice(0, 4);
    const expectedSignature = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    
    console.log('🔐 Validating DOCX signature:', {
      found: signature.toString('hex'),
      expected: expectedSignature.toString('hex'),
      isValid: signature.equals(expectedSignature)
    });

    if (!signature.equals(expectedSignature)) {
      throw new Error('Invalid DOCX format: Incorrect file signature');
    }

    // Enhanced buffer state logging
    console.log('📦 Processing DOCX buffer:', {
      totalLength: workingBuffer.length,
      header: workingBuffer.slice(0, 4).toString('hex'),
      isValidSignature: workingBuffer.slice(0, 4).equals(Buffer.from([0x50, 0x4B, 0x03, 0x04])),
      previewContent: workingBuffer.slice(4, 20).toString('hex')
    });

    // Store extracted images
    const images = [];
    
    // Get base name for folder structure
    const baseName = path.basename(originalName, '.docx');
    
    // Configure conversion options with strict settings
    const mammothOptions = {
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          // Enhanced image validation
          const imageBuffer = await image.read();
          console.log('🖼️ Processing image:', {
            contentType: image.contentType,
            size: imageBuffer?.length || 0,
            hasData: !!imageBuffer && imageBuffer.length > 0
          });

          if (!imageBuffer || imageBuffer.length === 0) {
            console.warn('⚠️ Empty image data encountered');
            return { src: '' };
          }

          // Validate image content type
          if (!image.contentType || !image.contentType.startsWith('image/')) {
            console.warn('⚠️ Invalid image content type:', image.contentType);
            return { src: '' };
          }

          const extension = image.contentType.split('/')[1] || 'png';
          const imageName = `${baseName}-${uuidv4().slice(0, 8)}.${extension}`;
          
          images.push({
            name: imageName,
            data: imageBuffer.toString('base64'),
            type: image.contentType,
            path: `images/${baseName}/${imageName}`
          });
          
          return {
            src: `images/${baseName}/${imageName}`
          };
        } catch (error) {
          console.error('Image processing error:', error);
          return { src: '' };
        }
      }),
      styleMap: [
        "p[style-name='Section Title'] => h1",
        "p[style-name='Subsection Title'] => h2"
      ]
    };

    // Add custom transform to detect page breaks if preservePageInfo is enabled
    let pageBreaks = [];
    if (options.preservePageInfo) {
      console.log('📄 Page break detection enabled');
      
      // Add custom transform to detect page breaks
      mammothOptions.transformDocument = (document) => {
        let currentPosition = 0;
        let pageNumber = 1;
        
        return mammoth.transforms.paragraph((paragraph) => {
          try {
            // Check if this paragraph has a page break
            const hasPageBreak = paragraph.alignment === 'center' && 
                                paragraph.styleId === 'Normal' && 
                                paragraph.numbering === undefined;
            
            if (hasPageBreak) {
              pageNumber++;
              pageBreaks.push({
                pageNumber,
                position: currentPosition
              });
            }
            
            // Update current position with null check
            if (paragraph.content) {
              currentPosition += paragraph.content.length;
            } else {
              console.log('⚠️ Paragraph without content encountered in transformDocument');
            }
            
            return paragraph;
          } catch (transformError) {
            console.error('❌ Error in paragraph transform:', transformError);
            // Return the paragraph unchanged if there's an error
            return paragraph;
          }
        })(document);
      };
    }

    console.log('⚙️ Converting DOCX with options:', {
      hasImageHandler: !!mammothOptions.convertImage,
      styleMapRules: mammothOptions.styleMap.length,
      bufferSize: workingBuffer.length,
      preservePageInfo: !!options.preservePageInfo
    });

      // Convert to HTML with enhanced error handling, timeout, and memory management
    let result;
    try {
      // Log initial memory state
      const initialMemory = process.memoryUsage();
      console.log('📊 Initial memory state:', {
        heapUsed: Math.round(initialMemory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(initialMemory.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(initialMemory.external / 1024 / 1024) + 'MB'
      });

      // Wrap mammoth conversion in a timeout promise with memory checks
      const conversionPromise = new Promise((resolve, reject) => {
        // Check memory usage before starting
        const beforeMemory = process.memoryUsage();
        if (beforeMemory.heapUsed > 0.8 * beforeMemory.heapTotal) {
          global.gc && global.gc(); // Run garbage collection if available
        }

        mammoth.convertToHtml(workingBuffer, mammothOptions)
          .then(result => {
            // Check memory usage after conversion
            const afterMemory = process.memoryUsage();
            console.log('📊 Memory usage after conversion:', {
              heapUsed: Math.round(afterMemory.heapUsed / 1024 / 1024) + 'MB',
              heapTotal: Math.round(afterMemory.heapTotal / 1024 / 1024) + 'MB',
              change: Math.round((afterMemory.heapUsed - beforeMemory.heapUsed) / 1024 / 1024) + 'MB'
            });
            resolve(result);
          })
          .catch(err => {
            console.error('❌ Mammoth internal error:', {
              error: err.message,
              stack: err.stack,
              type: err.name,
              memory: process.memoryUsage()
            });
            reject(err);
          });
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          const memoryState = process.memoryUsage();
          reject(new Error(`Conversion timed out after 30 seconds. Memory usage: ${Math.round(memoryState.heapUsed / 1024 / 1024)}MB`));
        }, 30000);
      });

      console.log('⏳ Starting mammoth conversion...');
      result = await Promise.race([conversionPromise, timeoutPromise]);
      
      // Force garbage collection after conversion if available
      if (global.gc) {
        console.log('🧹 Running garbage collection');
        global.gc();
      }

      const endMemory = process.memoryUsage();
      console.log('✅ Conversion completed:', {
        time: Date.now() - startTime + 'ms',
        finalMemory: Math.round(endMemory.heapUsed / 1024 / 1024) + 'MB'
      });

      // Additional validation of the conversion result
      if (!result) {
        console.error('❌ Null conversion result');
        throw new Error('Conversion returned no result');
      }

      if (typeof result.value !== 'string') {
        console.error('❌ Invalid conversion result:', {
          resultType: typeof result,
          valueType: typeof result?.value,
          hasMessages: Array.isArray(result?.messages),
          resultKeys: Object.keys(result || {}),
          valuePreview: result?.value ? JSON.stringify(result.value).substring(0, 100) : 'N/A'
        });
        throw new Error('Invalid conversion result format');
      }

      // Check for empty or whitespace-only content
      if (!result.value.trim()) {
        console.error('❌ Empty conversion result');
        throw new Error('Conversion produced empty content');
      }
      
      // Convert HTML to Markdown
      console.log('🔄 Converting HTML to Markdown');
      const htmlContent = result.value;
      
      // Create a DOM from the HTML
      const dom = new JSDOM(htmlContent);
      const document = dom.window.document;
      
      // Convert HTML to Markdown
      let markdownContent = htmlToMarkdown(document.body);
      
      // Clean up the Markdown
      markdownContent = cleanMarkdown(markdownContent);
      
      // Replace the HTML content with the Markdown content
      result.value = markdownContent;

    } catch (conversionError) {
      const errorDetails = {
        message: conversionError.message,
        name: conversionError.name,
        stack: conversionError.stack,
        bufferState: {
          length: workingBuffer.length,
          hasContent: workingBuffer.length > 0,
          signature: workingBuffer.slice(0, 4).toString('hex'),
          preview: workingBuffer.slice(0, 20).toString('hex')
        },
        timing: {
          elapsed: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };

      console.error('❌ Mammoth conversion error:', errorDetails);

      // Check for specific error conditions
      if (conversionError.message.includes('timed out')) {
        throw new Error(`DOCX conversion timed out after ${(Date.now() - startTime) / 1000}s - file may be too large or complex`);
      }

      if (conversionError.message.includes('Invalid format')) {
        throw new Error(`Invalid DOCX format - file may be corrupted. Signature: ${errorDetails.bufferState.signature}`);
      }

      if (conversionError.message.includes('memory')) {
        throw new Error('Memory limit exceeded during conversion - file may be too large');
      }

      // Provide detailed error message
      throw new Error(`DOCX conversion failed: ${conversionError.message}. Buffer length: ${workingBuffer.length}, Signature: ${errorDetails.bufferState.signature}, Time elapsed: ${errorDetails.timing.elapsed}ms`);
    }

    if (!result || !result.value) {
      console.error('❌ No content produced from conversion:', {
        resultExists: !!result,
        resultType: typeof result,
        valueExists: !!result?.value,
        valueType: typeof result?.value,
        messageCount: result?.messages?.length
      });
      throw new Error('Conversion produced no content. The DOCX file may be empty or corrupted.');
    }

    // Validate minimum content length
    if (result.value.length < 10) {
      console.warn('⚠️ Suspiciously short conversion result:', {
        length: result.value.length,
        content: result.value
      });
    }

    console.log('✅ Conversion successful:', {
      contentLength: result.value.length,
      hasWarnings: result.messages.length > 0,
      warningCount: result.messages.length,
      imageCount: images.length,
      pageBreakCount: pageBreaks.length,
      contentPreview: result.value.substring(0, 100),
      memoryUsage: process.memoryUsage(),
      conversionTime: Date.now() - startTime
    });

    // Enhanced warning logging
    if (result.messages.length > 0) {
      console.warn('⚠️ Conversion warnings:', {
        count: result.messages.length,
        warnings: result.messages.map(msg => ({
          type: msg.type,
          message: msg.message,
          paragraph: msg.paragraph?.substring(0, 50)
        }))
      });
    }

    // Create enhanced frontmatter and content
    // Remove temp_ prefix from title if present
    let cleanTitle = baseName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    const markdown = [
      '---',
      `title: ${cleanTitle}`,
      `imagesFolder: images/${baseName}`,
      'created: ' + new Date().toISOString(),
      `originalName: ${originalName}`,
      `conversionTime: ${Date.now() - startTime}ms`,
      `imageCount: ${images.length}`,
      `warningCount: ${result.messages.length}`,
      `page_count: ${options.preservePageInfo && pageBreaks.length > 0 ? pageBreaks.length + 1 : 1}`,
      '---',
      '',
      '<!-- DOCX Conversion Result -->',
      '',
      result.value
    ].join('\n');

    // Explicitly set success flag
    return {
      success: true,
      content: markdown,
      images: images,
      pageBreaks: options.preservePageInfo ? pageBreaks : undefined,
      warnings: result.messages
    };

  } catch (error) {
    console.error('Error converting DOCX:', error);
    throw new Error(`DOCX conversion failed: ${error.message}`);
  }
}

/**
 * Default export for the DOCX converter
 * Follows the same pattern as other converters for consistency
 */
export default {
  convert: convertDocxToMarkdown
};
