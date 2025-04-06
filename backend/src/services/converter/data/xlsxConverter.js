// services/converter/data/xlsxConverter.js

import xlsx from 'xlsx';
import path from 'path';

/**
 * XLSX Converter
 * Converts Excel files to Markdown format with consistent return structure
 * 
 * This converter follows the same pattern as the PDF converter to ensure
 * consistent behavior across all file types.
 * 
 * Related files:
 * - csvConverter.js: Similar converter for CSV files
 * - PdfConverterFactory.js: Reference implementation for converter pattern
 */

/**
 * Configuration for the converter
 */
const config = {
  name: 'XLSX Converter',
  version: '1.0.0',
  supportedExtensions: ['.xlsx', '.xls'],
  supportedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ],
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
};

/**
 * Validates XLSX input
 * @param {Buffer|string} input - The XLSX content
 * @returns {boolean} - Whether the input is valid
 */
export function validateXlsxInput(input) {
  return Buffer.isBuffer(input) && input.length > 0;
}

/**
 * Creates metadata object for XLSX files
 * @param {string} baseName - Base filename
 * @param {number} sheets - Number of sheets
 * @returns {Object} - Metadata object
 */
function createMetadata(baseName, sheets) {
  return {
    title: baseName,
    sheets,
    format: 'xlsx',
    type: 'spreadsheet',
    created: new Date().toISOString()
  };
}

/**
 * Converts an XLSX buffer to Markdown format.
 * @param {Buffer} input - The XLSX content as a buffer.
 * @param {string} originalName - Original filename for context.
 * @param {string} [apiKey] - API key if needed.
 * @returns {Promise<{ content: string, images: Array, success: boolean, metadata: Object, type: string, name: string, category: string }>} - Converted content and metadata.
 */
export async function convertXlsxToMarkdown(input, originalName, apiKey) {
  console.log(`🔄 [xlsxConverter] Converting XLSX file: ${originalName}`);
  console.log(`🔄 [xlsxConverter] Input type: ${typeof input}, is buffer: ${Buffer.isBuffer(input)}, length: ${input ? input.length : 'N/A'}`);
  
  try {
    // Validate input
    if (!validateXlsxInput(input)) {
      throw new Error('Invalid XLSX input: must be a buffer');
    }
    
    // Read the workbook
    const workbook = xlsx.read(input, { type: 'buffer' });
    console.log(`✅ [xlsxConverter] Successfully read XLSX workbook with ${workbook.SheetNames.length} sheets`);
    
    const baseName = path.basename(originalName, path.extname(originalName));
    
    // Create metadata
    const metadata = createMetadata(baseName, workbook.SheetNames.length);
    
    // Create frontmatter
    const frontmatter = [
      '---',
      `source: ${originalName}`,
      `type: ${metadata.type}`,
      `format: ${metadata.format}`,
      `sheets: ${metadata.sheets}`,
      `created: ${metadata.created}`,
      '---',
      ''
    ].join('\n');

    // Table of contents for sheets
    let markdownContent = `# ${baseName}\n\n`;
    markdownContent += '## Sheet Index\n\n';
    workbook.SheetNames.forEach(sheetName => {
      markdownContent += `- [[#${sheetName}|${sheetName}]]\n`;
    });
    markdownContent += '\n---\n\n';

    // Track total rows and columns
    let totalRows = 0;
    let totalColumns = 0;

    // Convert each sheet
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      
      if (jsonData.length === 0) {
        markdownContent += `## ${sheetName}\n\nThis sheet is empty.\n\n`;
        return;
      }

      const headers = jsonData[0];
      totalRows += jsonData.length - 1; // Exclude header row
      totalColumns = Math.max(totalColumns, headers.length);
      
      // Calculate column widths for better formatting
      const columnWidths = headers.map((_, colIndex) => {
        return Math.max(
          String(headers[colIndex] || '').length,
          ...jsonData.slice(1).map(row => String(row[colIndex] || '').length)
        );
      });

      // Add sheet header with metadata
      markdownContent += `## ${sheetName}\n\n`;
      markdownContent += `Rows: ${jsonData.length - 1}\n`;
      markdownContent += `Columns: ${headers.length}\n\n`;

      // Create table header
      markdownContent += '| ' + headers.map((header, i) => 
        String(header).padEnd(columnWidths[i])
      ).join(' | ') + ' |\n';
      
      markdownContent += '| ' + columnWidths.map(width => 
        '-'.repeat(width)
      ).join(' | ') + ' |\n';

      // Add data rows
      jsonData.slice(1).forEach(row => {
        const formattedRow = headers.map((_, i) => 
          String(row[i] || '').padEnd(columnWidths[i])
        ).join(' | ');
        markdownContent += `| ${formattedRow} |\n`;
      });

      markdownContent += '\n---\n\n';
    });

    // Combine frontmatter and content
    const fullContent = frontmatter + markdownContent;
    
    // Create the final result object with all required properties
    const result = { 
      success: true,
      content: fullContent,
      images: [],
      metadata,
      type: 'xlsx',
      name: originalName,
      category: 'data',
      originalContent: input,
      stats: {
        inputSize: input.length,
        outputSize: fullContent.length,
        sheetCount: workbook.SheetNames.length,
        totalRows,
        totalColumns
      }
    };
    
    console.log(`✅ [xlsxConverter] Successfully converted XLSX file: ${originalName}`);
    return result;
  } catch (error) {
    console.error('❌ Error converting XLSX to Markdown:', error);
    // Return a structured error result instead of throwing
    return {
      success: false,
      error: error.message,
      content: `# Conversion Error\n\nFailed to convert XLSX file: ${error.message}`,
      images: [],
      metadata: {
        format: 'xlsx',
        type: 'spreadsheet',
        error: true
      },
      type: 'xlsx',
      name: originalName,
      category: 'data'
    };
  }
}

// Export a default object to match the pattern used by other converters
export default {
  convertToMarkdown: convertXlsxToMarkdown,
  validateXlsxInput,
  config
};
