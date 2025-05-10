/**
 * Test harness for Mistral OCR integration
 * 
 * This is a simple manual test script to verify the functionality of the
 * refactored Mistral OCR integration. It's not meant to be a comprehensive
 * test suite, but rather a quick way to verify that the basic functionality
 * works as expected.
 * 
 * Usage:
 *   node test-harness.js <pdf-file-path>
 */

const fs = require('fs');
const path = require('path');
const { MistralApiClient, OcrProcessor, MarkdownGenerator } = require('./index');

// Mock for FileStorageService
const mockFileStorage = {
  createTempDir: async (prefix) => {
    const tmpDir = path.join(require('os').tmpdir(), `${prefix}-${Date.now()}`);
    await fs.promises.mkdir(tmpDir, { recursive: true });
    return tmpDir;
  }
};

// Mock for FileProcessorService
const mockFileProcessor = {
  processFile: async (filePath) => {
    return { path: filePath, mimeType: 'application/pdf' };
  }
};

async function runTest(pdfPath) {
  try {
    console.log(`Testing Mistral OCR integration with file: ${pdfPath}`);
    
    // Test MistralApiClient
    console.log('\n=== Testing MistralApiClient ===');
    const apiClient = new MistralApiClient({
      apiKey: process.env.MISTRAL_API_KEY
    });
    
    console.log('Checking API key validity...');
    const keyCheck = await apiClient.validateApiKey();
    console.log('API key check result:', keyCheck);
    
    if (!keyCheck.valid) {
      console.error('Cannot proceed with testing: Invalid API key');
      return;
    }
    
    // Read PDF file
    console.log('\nReading PDF file...');
    const fileBuffer = await fs.promises.readFile(pdfPath);
    
    // Process with OCR
    console.log('\n=== Processing PDF with OCR ===');
    const ocrResult = await apiClient.processDocument(
      fileBuffer,
      path.basename(pdfPath),
      { model: 'mistral-ocr-latest' }
    );
    
    console.log('OCR processing completed');
    console.log('OCR result structure:', Object.keys(ocrResult));
    
    // Process OCR result
    console.log('\n=== Processing OCR result ===');
    const processor = new OcrProcessor();
    const processedResult = processor.processResult(ocrResult);
    
    console.log('OCR result processing completed');
    console.log(`Processed ${processedResult.pages.length} pages`);
    console.log('Document model:', processedResult.documentInfo.model);
    
    // Generate markdown
    console.log('\n=== Generating markdown ===');
    const generator = new MarkdownGenerator();
    
    // Mock metadata
    const mockMetadata = {
      title: 'Test PDF',
      author: 'Test Author',
      subject: 'Test Subject',
      pageCount: processedResult.pages.length
    };
    
    const markdown = generator.generateMarkdown(mockMetadata, processedResult);
    
    // Save markdown to file
    const markdownPath = path.join(process.cwd(), 'test-output.md');
    await fs.promises.writeFile(markdownPath, markdown);
    
    console.log(`Markdown generated and saved to: ${markdownPath}`);
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Get PDF path from command line argument or use default
const pdfPath = process.argv[2] || '../test-files/sample.pdf';

// Run the test
runTest(pdfPath);