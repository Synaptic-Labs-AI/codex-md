/**
 * test-mistral-ocr.js
 * 
 * This script tests the Mistral OCR PDF conversion functionality.
 * It uses the MistralPdfConverter directly to convert a PDF file to markdown.
 * 
 * Usage:
 * node scripts/test-mistral-ocr.js <path-to-pdf-file>
 * 
 * Example:
 * node scripts/test-mistral-ocr.js test-files/sample.pdf
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const MistralPdfConverter = require('../src/electron/services/conversion/document/MistralPdfConverter');

// Check if API key is available
if (!process.env.MISTRAL_API_KEY) {
  console.error('Error: MISTRAL_API_KEY environment variable is not set.');
  console.error('Please set the MISTRAL_API_KEY environment variable before running this script.');
  console.error('Example: MISTRAL_API_KEY=your-api-key node scripts/test-mistral-ocr.js test-files/sample.pdf');
  process.exit(1);
}

// Check if file path is provided
if (process.argv.length < 3) {
  console.error('Error: No PDF file path provided.');
  console.error('Usage: node scripts/test-mistral-ocr.js <path-to-pdf-file>');
  process.exit(1);
}

// Get file path from command line arguments
const filePath = path.resolve(process.argv[2]);

// Check if file exists
if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found: ${filePath}`);
  process.exit(1);
}

// Check if file is a PDF
if (!filePath.toLowerCase().endsWith('.pdf')) {
  console.error(`Error: File is not a PDF: ${filePath}`);
  process.exit(1);
}

// Create a temporary output directory
const outputDir = path.join(require('os').tmpdir(), `mistral-ocr-test-${uuidv4()}`);
fs.ensureDirSync(outputDir);

console.log(`Testing Mistral OCR conversion for: ${filePath}`);
console.log(`Output directory: ${outputDir}`);

// Create an instance of MistralPdfConverter
// Pass true for skipHandlerSetup to avoid IPC handler registration
const converter = new MistralPdfConverter(null, null, null, true);

// Set the API key
converter.apiKey = process.env.MISTRAL_API_KEY;

// Read the PDF file
fs.readFile(filePath)
  .then(async (buffer) => {
    console.log(`File size: ${buffer.length} bytes`);
    
    try {
      // Convert the PDF to markdown
      console.log('Starting conversion...');
      const result = await converter.convertToMarkdown(buffer, {
        name: path.basename(filePath),
        useOcr: true,
        preservePageInfo: true
      });
      
      // Check if conversion was successful
      if (result.success) {
        console.log('Conversion successful!');
        
        // Write the markdown to a file
        const outputFile = path.join(outputDir, `${path.basename(filePath, '.pdf')}.md`);
        await fs.writeFile(outputFile, result.content);
        
        console.log(`Markdown saved to: ${outputFile}`);
        console.log(`OCR Info: ${JSON.stringify(result.ocrInfo, null, 2)}`);
      } else {
        console.error('Conversion failed:', result.error);
        console.error('Error details:', result.errorDetails);
      }
    } catch (error) {
      console.error('Error during conversion:', error);
    }
  })
  .catch((error) => {
    console.error('Error reading file:', error);
  })
  .finally(() => {
    console.log('Test completed.');
  });
